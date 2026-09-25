import {
  RdoPacket,
  RdoVerb,
  RdoAction,
  RDO_CONSTANTS,
  RDO_ERROR_CODES
} from '../shared/types';
import {
  RdoValue,
  RdoParser,
  assertValidRdoIdentifier,
  encodeRdoLiteral,
  isRdoTypePrefix,
  isWellFormedRdoLiteral
} from '../shared/rdo-types';
import { decodeAnsi } from '../shared/cp1252';

/**
 * The three actions the grammar admits (§1.3). Kept as a runtime set because
 * `RdoAction` is erased at compile time: WebSocket messages arrive as plain
 * `JSON.parse` output, so the type annotation guarantees nothing about what
 * actually reaches `format()`.
 */
const RDO_ACTIONS: ReadonlySet<string> = new Set(Object.values(RdoAction));

/**
 * RDO Protocol Engine
 * -------------------
 * Handles framing (splitting TCP streams by delimiter) and
 * parsing/formatting of ASCII commands with Strict Typing rules.
 */

export class RdoFramer {
  private buffer: string = '';

  /** Maximum buffer size (5MB) to prevent memory exhaustion from malformed packets */
  private static readonly MAX_BUFFER_SIZE = 5 * 1024 * 1024;

  /**
   * Find the next unquoted semicolon delimiter position.
   * Per Delphi's KeyWordPos (RDOUtils.pas), semicolons inside "..." are skipped.
   */
  private findDelimiter(): number {
    let inQuotes = false;
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === RDO_CONSTANTS.PACKET_DELIMITER && !inQuotes) {
        return i;
      }
    }
    return -1;
  }

  public ingest(chunk: Buffer | string): string[] {
    // decodeAnsi, not toString('latin1') — the read half of P-H2. latin1 maps
    // every byte to the code point of the same value, so 0x93 (what a Delphi
    // client sends for `"`) arrived as U+0093, a C1 control, and rendered as
    // mojibake. Metacharacters are ASCII, so framing is unaffected either way.
    this.buffer += typeof chunk === 'string' ? chunk : decodeAnsi(chunk);

    // Guard against unbounded buffer growth (malformed packets with unclosed quotes)
    //
    // P-L6: this used to do `this.buffer = ''` and `return []`, discarding the
    // COMPLETE frames sitting at the head of the buffer along with the corrupt
    // tail. Overflow means one frame never terminated; everything before its
    // start is intact and already parsed by the loop below. Losing those is a
    // silent data loss on top of the corruption — and the responses they carry
    // are requests that then wait out their full timeout (see P-L7).
    //
    // Keep the parsed prefix, drop only from the last frame boundary onward.
    if (this.buffer.length > RdoFramer.MAX_BUFFER_SIZE) {
      const lastBoundary = this.buffer.lastIndexOf(RDO_CONSTANTS.PACKET_DELIMITER);
      const salvaged = lastBoundary >= 0 ? this.buffer.slice(0, lastBoundary + 1) : '';
      console.error(
        `[RdoFramer] Buffer exceeded ${RdoFramer.MAX_BUFFER_SIZE} bytes; ` +
        `discarding ${this.buffer.length - salvaged.length} bytes of unterminated tail, ` +
        `keeping ${salvaged.length} bytes of complete frames`
      );
      this.buffer = salvaged;
    }

    const messages: string[] = [];

    while (true) {
      // Malformed busy rejection recovery: an overloaded server emits "A"+"error <n>"
      // with NO QueryId and NO ";" terminator (WinSockRDOConnectionsServer.pas:812).
      // Left in the buffer it glues onto the next frame and corrupts it. The buffer
      // always starts at a frame boundary here, and real frames start with "A<digits>"
      // or "C", so this prefix can only be the malformed reply. The (?=\D) lookahead
      // waits for the next byte (frames start with A/C) so a chunk-split error code
      // is never truncated.
      const busyMatch = this.buffer.match(/^A ?error \d+(?=\D)/);
      if (busyMatch) {
        messages.push(busyMatch[0]);
        this.buffer = this.buffer.substring(busyMatch[0].length);
        continue;
      }

      const delimiterIndex = this.findDelimiter();
      if (delimiterIndex === -1) break;

      const message = this.buffer.substring(0, delimiterIndex).trim();
      if (message.length > 0) {
        messages.push(message);
      }
      this.buffer = this.buffer.substring(delimiterIndex + 1);
    }

    return messages;
  }
}

export class RdoProtocol {
  /**
   * Drops the frame terminator, if the string still carries one.
   *
   * `RdoCommand.build()` always appends `;` — it is part of the frame that goes
   * on the wire — while `RdoFramer` consumes it when it cuts the stream. So
   * `parse()` sees a terminated frame only when it is handed a complete frame
   * directly, and it used to fold that `;` into the last token: the closing
   * quote was no longer final, so `"%15";` came back instead of `%15` and an
   * emitted frame could not match itself when re-parsed.
   *
   * Only an UNQUOTED trailing `;` is a terminator — the same rule
   * `RdoFramer.findDelimiter()` applies when it splits the stream. A `;` that
   * closes an unbalanced quote is payload, and is left alone.
   */
  private static stripTerminator(trimmed: string): string {
    if (!trimmed.endsWith(RDO_CONSTANTS.PACKET_DELIMITER)) return trimmed;

    let inQuotes = false;
    for (let i = 0; i < trimmed.length - 1; i++) {
      if (trimmed[i] === '"') inQuotes = !inQuotes;
    }
    if (inQuotes) return trimmed;

    return trimmed.slice(0, -1).trimEnd();
  }

  /**
   * Parses a raw protocol string into a structured RdoPacket.
   */
  public static parse(raw: string): RdoPacket {
    const trimmed = this.stripTerminator(raw.trim());

    // 1. Detect Packet Type. `raw` stays the caller's string: the sub-parsers
    // work on the normalised form, but the packet reports what came in.
    if (trimmed.startsWith(RDO_CONSTANTS.CMD_PREFIX_ANSWER)) {
      return { ...this.parseResponse(trimmed), raw };
    } else if (trimmed.startsWith(RDO_CONSTANTS.CMD_PREFIX_CLIENT)) {
      return { ...this.parseCommand(trimmed), raw };
    }

    return {
      raw,
      type: 'PUSH',
      payload: trimmed
    };
  }

	  private static parseResponse(raw: string): RdoPacket {
		// Regex: A(\d+)\s+(.*)
		const match = raw.match(/^A(\d+)\s*([\s\S]*)$/);
		if (!match) {
		  // Malformed busy rejection: "A"+"error <n>" with no QueryId
		  // (WinSockRDOConnectionsServer.pas:812). Surface the error code so the
		  // session can flip its busy flag instead of dropping the signal.
		  const busyMatch = raw.match(/^A ?error (\d+)\s*$/);
		  if (busyMatch) {
			const code = parseInt(busyMatch[1], 10);
			return {
			  raw,
			  type: 'RESPONSE',
			  payload: raw.substring(1).trim(),
			  errorCode: code,
			  errorName: RDO_ERROR_CODES[code] ?? `unknownError(${code})`,
			};
		  }
		  return { raw, type: 'RESPONSE', payload: raw };
		}

		const payload = match[2];
		const packet: RdoPacket = {
		  raw,
		  type: 'RESPONSE',
		  rid: parseInt(match[1], 10),
		  payload,
		};

		// Check for RDO error response (ErrorCodes.pas:0-17). Delphi emits three forms:
		//   "error <code>"                       (CallCommand/IdOfCommand)
		//   "error <code> getting <PropName>"    (GetCommand — RDOQueryServer.pas:274)
		//   "error <code> setting <PropName>"    (SetCommand)
		// Anchored full-match so quoted payloads containing the word "error" never match.
		const errorMatch = payload.match(/^error\s+(\d+)(?:\s+(getting|setting)\s+(\S+))?\s*$/i);
		if (errorMatch) {
		  const code = parseInt(errorMatch[1], 10);
		  packet.errorCode = code;
		  const baseName = RDO_ERROR_CODES[code] ?? `unknownError(${code})`;
		  packet.errorName = errorMatch[2]
		    ? `${baseName} (${errorMatch[2].toLowerCase()} ${errorMatch[3]})`
		    : baseName;
		}

		return packet;
	  }

	  /**
	   * Helper: Tokenize RDO content en respectant les quotes
	   */
	  private static tokenizeRdoCommand(content: string): string[] {
		const tokens: string[] = [];
		let current = '';
		let inQuotes = false;

		for (let i = 0; i < content.length; i++) {
		  const char = content[i];
		  if (char === '"' && (i === 0 || content[i-1] !== '\\')) {
			inQuotes = !inQuotes;
			current += char;
		  } else if (char === ' ' && !inQuotes) {
			if (current.length > 0) {
			  tokens.push(current);
			  current = '';
			}
		  } else {
			current += char;
		  }
		}

		if (current.length > 0) {
		  tokens.push(current);
		}

		return tokens;
	  }


	 private static parseCommand(raw: string): RdoPacket {
		let content = raw.substring(1).trim();
		let rid: number | undefined;
		let type: 'REQUEST' | 'PUSH' = 'PUSH';

		// Check request ID ([\s\S]* to match across newlines in multi-line args)
		const ridMatch = content.match(/^(\d+)\s+([\s\S]*)$/);
		if (ridMatch) {
			rid = parseInt(ridMatch[1], 10);
			content = ridMatch[2];
			// CRITICAL: If there's a RID, this is a REQUEST from server (needs response)
			type = 'REQUEST';
		}

		// Split by space but respect quotes
		const parts = this.tokenizeRdoCommand(content);
		const verbStr = parts[0];

		const packet: RdoPacket = {
			raw,
			type,
			rid,
		};

		if (verbStr === RdoVerb.IDOF) {
			packet.verb = RdoVerb.IDOF;
			// Strip quotes from targetId for internal usage
			const rawTarget = parts.slice(1).join(' ');
			packet.targetId = rawTarget.replace(/^"|"$/g, '');
		} else if (verbStr === RdoVerb.SEL) {
			packet.verb = RdoVerb.SEL;
			if (parts.length >= 3) {
				packet.targetId = parts[1];
				const actionStr = parts[2];

				if (Object.values(RdoAction).includes(actionStr as RdoAction)) {
					packet.action = actionStr as RdoAction;
					const remainder = parts.slice(3).join(' ');

					if (packet.action === RdoAction.CALL) {
						// Format: sel ID call Member "^"|"*" Arg1,Arg2
						// The separator is the token that FOLLOWS the member name — never a
						// "^"/"*" found further on, which may sit inside a quoted argument
						// (a chat line `a "^" b` travels as "%a ""^"" b").
						const sepMatch = remainder.match(/^\s*([^\s"]+)\s*("\^"|"\*")/);
						if (sepMatch) {
							packet.member = sepMatch[1];
							packet.separator = sepMatch[2];
							const argsStr = remainder.substring(sepMatch[0].length).trim();
							if (argsStr.length > 0) {
								const rawArgs = this.parseQuotedArgs(argsStr);
								packet.args = rawArgs.map(arg => this.stripTypedToken(arg));
							} else {
								packet.args = [];
							}
						} else {
							packet.member = remainder;
						}
					} else {
						// get/set
						const propParts = remainder.split(/\s+/);
						packet.member = propParts[0];
						if (packet.action === RdoAction.SET && propParts.length > 1) {
							const rawArg = propParts.slice(1).join(' ');
							packet.args = [this.stripTypedToken(rawArg)];
						}
					}
				}
			}
		} else if (packet.payload) {
			parts.push(packet.payload);
		}

		return packet;
	}

	/**
	 * NEW: Parse comma-separated arguments respecting quoted multi-line strings
	 */
	private static parseQuotedArgs(argsStr: string): string[] {
		const args: string[] = [];
		let current = '';
		let inQuotes = false;
		
		for (let i = 0; i < argsStr.length; i++) {
			const char = argsStr[i];
			
			if (char === '"' && (i === 0 || argsStr[i - 1] !== '\\')) {
				inQuotes = !inQuotes;
				current += char;
			} else if (char === ',' && !inQuotes) {
				// End of argument
				if (current.trim().length > 0) {
					args.push(current.trim());
				}
				current = '';
			} else {
				current += char;
			}
		}
		
		// Add last argument
		if (current.trim().length > 0) {
			args.push(current.trim());
		}
		
		return args;
	}



  /**
   * Formats a structured packet back into an ASCII string with STRICT TYPING.
   */
  public static format(packet: RdoPacket): string {
    const parts: string[] = [];

    // 1. Prefix and RID
    parts.push(RDO_CONSTANTS.CMD_PREFIX_CLIENT);
    if (packet.rid !== undefined) {
      parts.push(packet.rid.toString());
    }

    // 2. Verb and Target
    if (packet.verb) {
      parts.push(packet.verb);
      // Guard: reject sel 0 (null pointer on Delphi server)
      if (packet.verb === RdoVerb.SEL && (!packet.targetId || packet.targetId === '0')) {
        throw new Error(`Invalid RDO target ID: ${packet.targetId} (sel 0 is a null pointer on the server)`);
      }
      // Object ids are Delphi pointers rendered as decimal (RDOObjectServer.pas
      // registration). Anything else is a caller-supplied string being spliced
      // into the frame unquoted — `42 call Evil "*" "` would be a second
      // sub-command. This is the chokepoint: every caller-supplied targetId
      // reaches the wire through here, so the check must live at this level.
      if (packet.verb === RdoVerb.SEL && !/^\d+$/.test(packet.targetId!)) {
        throw new Error(`Invalid RDO target ID: ${packet.targetId} (sel takes a decimal object id)`);
      }
      // CRITICAL FIX: For idof, the targetId MUST be in quotes.
      // The name is a bare quoted string (no type prefix) — `idof "DirectoryServer"`
      // (live capture) — so its own quotes must be doubled or it breaks out.
      if (packet.verb === RdoVerb.IDOF && packet.targetId) {
        parts.push(`"${packet.targetId.replace(/"/g, '""')}"`);
      } else if (packet.targetId) {
        parts.push(packet.targetId);
      }
    }

    // 3. Action — spliced in unquoted at the <SubCmd> position of the grammar
    // (§1.3), the very position the `repeat … until QueryTerm` loop of
    // ExecQuery re-iterates (RDOQueryServer.pas:133-160). An unvalidated value
    // is therefore a second sub-command, exactly like member and targetId were.
    // `action?: RdoAction` is a compile-time type only — WS messages arrive as
    // plain JSON.parse with no schema, so the value must be validated here.
    if (packet.action) {
      if (!RDO_ACTIONS.has(packet.action)) {
        throw new Error(
          `Invalid RDO action: ${JSON.stringify(packet.action)} (expected get, set or call)`
        );
      }
      parts.push(packet.action);

      // 4. Member (Method/Property). Delphi's ReadIdent (RDOUtils.pas:70-78)
      // stops at the first non-identifier character and feeds the remainder back
      // to the sub-command loop, so an unvalidated name is a code-execution
      // primitive, not a parse error (P-H3).
      if (packet.member) {
        assertValidRdoIdentifier(packet.member, packet.action);
        if (packet.action === RdoAction.SET) {
          // Simplified SET format
          parts.push(`${packet.member}=${this.formatTypedToken(packet.args?.[0] || '')}`);
        } else {
          parts.push(packet.member);
        }
      }

      // 5. Separator & Args (for calls only)
      if (packet.action === RdoAction.CALL) {
        const separator = packet.separator
          ? packet.separator
          : (packet.rid !== undefined ? RDO_CONSTANTS.METHOD_SEPARATOR : RDO_CONSTANTS.PUSH_SEPARATOR);

        // CRITICAL FIX: Separator must be quoted in protocol — convert ^, * to "^", "*".
        // Only the two ReturnMarker literals of the grammar (§1.3) are accepted:
        // the separator is spliced into the frame unquoted, so a free-form value
        // would be one more injection point (same family as P-M2).
        const bareSeparator = separator.replace(/"/g, '');
        if (bareSeparator !== '^' && bareSeparator !== '*') {
          throw new Error(`Invalid RDO separator: ${JSON.stringify(separator)} (expected "^" or "*")`);
        }
        parts.push(`"${bareSeparator}"`);

        // Format arguments with proper quoting
        if (packet.args && packet.args.length > 0) {
          // CALL args: disable numeric auto-typing — callers must use RdoValue.int() explicitly.
          // Prevents numeric strings (usernames, passwords) from being mistyped as integers.
          const formattedArgs = packet.args.map(arg => this.formatTypedToken(arg, false));
          parts.push(formattedArgs.join(RDO_CONSTANTS.TOKEN_SEPARATOR));
        }
      }
    } else if (packet.payload) {
      parts.push(packet.payload);
    }

    return parts.join(' ');
  }


  /**
   * Format one argument into exactly one RDO literal.
   *
   * ## Invariant (P-M2)
   *
   * **Whatever `val` contains, the returned token is a single balanced RDO
   * literal.** It can never terminate its own quotes early, so it can never
   * become a second sub-command of the enclosing `sel` — which the Delphi
   * `ExecQuery` loop would happily execute (`RDOQueryServer.pas:133-160`).
   *
   * Before this rewrite two branches broke that invariant by returning a token
   * verbatim whenever it merely *started* with a type prefix, without doubling
   * its internal `"`. Reachable pre-authentication through `username` / `pass`
   * (`session/login-handler.ts:198,202`), and in pure ASCII — so the L1 codec
   * did not close it.
   *
   * ## Byte-identity
   *
   * For every input that contains no `"` the output is bit-for-bit what the
   * previous implementation produced; likewise for any token already emitted by
   * `RdoValue.format()`, which is well-formed by construction and passed through
   * untouched (step 1). Only malformed / hostile tokens change — and only to
   * become correctly escaped.
   *
   * @param val             raw argument, possibly already an RDO literal
   * @param autoTypeNumeric SET only: bare integers become `"#n"`. Kept ON for
   *                        SET — `set EnableEvents` relies on it (O-L7).
   */
  private static formatTypedToken(val: string, autoTypeNumeric = true): string {
    // 1. Already exactly one complete, correctly escaped literal (the normal
    //    case for anything built with RdoValue.format()). Pass through
    //    untouched — re-encoding here would run encodeAnsi a second time, which
    //    is lossy once the CP1252 band is active (shared/cp1252.ts, lot L11).
    if (isWellFormedRdoLiteral(val)) {
      return val;
    }

    // 2. Bare typed token, no quotes anywhere: `#42`, `%Inbox`, `!3.14`.
    //    Quoting is all that is missing, and with no `"` in the value there is
    //    nothing to escape — byte-identical to the previous behaviour, and no
    //    transcoding pass is introduced where there was none.
    if (isRdoTypePrefix(val.charAt(0)) && !val.includes('"')) {
      return `"${val}"`;
    }

    // 3. Everything else is untrusted text. Strip a stray pair of outer quotes
    //    (an unbalanced literal — a well-formed one was caught by step 1), then
    //    re-emit through the single escaping chokepoint.
    let cleaned = val;
    if (cleaned.length >= 2 && cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.substring(1, cleaned.length - 1);
    }

    // 3a. Caller declared a type prefix but the body carries a quote: honour the
    //     declared type, escape the body. Same prefix as before the fix, same
    //     bytes whenever the body is quote-free — but now unbreakable.
    const declaredPrefix = cleaned.charAt(0);
    if (isRdoTypePrefix(declaredPrefix)) {
      return encodeRdoLiteral(declaredPrefix, cleaned.substring(1));
    }

    // 3b. Auto-type numeric values only for SET operations (property assignments).
    //     CALL args default to OLEString — numeric usernames/passwords must remain
    //     as "%12345" not "#12345" (Delphi Logon expects OLEString parameters).
    if (autoTypeNumeric && /^-?\d+$/.test(cleaned)) {
      return RdoValue.int(parseInt(cleaned, 10)).format();
    }

    return RdoValue.string(cleaned).format();
  }

  /**
   * Strip outer quotes and optionally type prefix from parsed tokens
   * Uses RdoParser for consistent extraction
   */
  private static stripTypedToken(token: string): string {
    const extracted = RdoParser.extract(token);
    // Return the full string with prefix (e.g., "#42", "%hello")
    // This preserves type information for downstream processing
    if (extracted.prefix) {
      return extracted.prefix + extracted.value;
    }
    return extracted.value;
  }
  
	
}
