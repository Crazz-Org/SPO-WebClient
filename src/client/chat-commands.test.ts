import { describe, it, expect, jest } from '@jest/globals';
import { runChatCommand, splitChatCoordinates, type ChatCommandContext } from './chat-commands';

function makeCtx(): ChatCommandContext & {
  moveTo: jest.Mock;
  setAway: jest.Mock;
  endComposition: jest.Mock;
  tellPlayer: jest.Mock;
} {
  return {
    moveTo: jest.fn(),
    setAway: jest.fn(),
    endComposition: jest.fn(),
    tellPlayer: jest.fn(),
  };
}

describe('runChatCommand', () => {
  it('/go x,y moves the camera and ends composition, handled', () => {
    const ctx = makeCtx();
    expect(runChatCommand('/go 10,20', ctx)).toBe('handled');
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 20);
    expect(ctx.endComposition).toHaveBeenCalled();
    expect(ctx.tellPlayer).not.toHaveBeenCalled();
  });

  it('is case-insensitive on the command word and tolerates spaces around the comma', () => {
    const ctx = makeCtx();
    expect(runChatCommand('/GO 10, 20', ctx)).toBe('handled');
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 20);
  });

  it('/go alone (no argument) tells the player and does not move the camera, still handled', () => {
    const ctx = makeCtx();
    expect(runChatCommand('/go', ctx)).toBe('handled');
    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(ctx.tellPlayer).toHaveBeenCalledWith('Usage: /go x,y');
    expect(ctx.endComposition).toHaveBeenCalled();
  });

  it('/go abc (malformed argument) tells the player and does not move the camera, still handled', () => {
    const ctx = makeCtx();
    expect(runChatCommand('/go abc', ctx)).toBe('handled');
    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(ctx.tellPlayer).toHaveBeenCalledWith('Usage: /go x,y');
    expect(ctx.endComposition).toHaveBeenCalled();
  });

  it('/afk sets the away state, handled, and does not end composition', () => {
    const ctx = makeCtx();
    expect(runChatCommand('/afk', ctx)).toBe('handled');
    expect(ctx.setAway).toHaveBeenCalled();
    expect(ctx.endComposition).not.toHaveBeenCalled();
  });

  it('/AFK (case) is recognised the same way', () => {
    const ctx = makeCtx();
    expect(runChatCommand('/AFK', ctx)).toBe('handled');
    expect(ctx.setAway).toHaveBeenCalled();
  });

  it('an unrecognised /word is not handled', () => {
    const ctx = makeCtx();
    expect(runChatCommand('/hello', ctx)).toBe('not-handled');
    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(ctx.setAway).not.toHaveBeenCalled();
    expect(ctx.tellPlayer).not.toHaveBeenCalled();
  });

  it('/gm ... (the existing GM path) is not handled, so it keeps flowing to onSendChatMessage', () => {
    const ctx = makeCtx();
    expect(runChatCommand('/gm hi', ctx)).toBe('not-handled');
  });

  it('plain text is not handled', () => {
    const ctx = makeCtx();
    expect(runChatCommand('let us go to the park', ctx)).toBe('not-handled');
  });
});

describe('splitChatCoordinates', () => {
  it('returns a single text segment for a line with no coordinate', () => {
    expect(splitChatCoordinates('hello there')).toEqual([{ kind: 'text', text: 'hello there' }]);
  });

  it('splits a line with one coordinate', () => {
    expect(splitChatCoordinates('meet me at 120,340!')).toEqual([
      { kind: 'text', text: 'meet me at ' },
      { kind: 'coord', text: '120,340', x: 120, y: 340 },
      { kind: 'text', text: '!' },
    ]);
  });

  it('splits a line with two coordinates', () => {
    expect(splitChatCoordinates('go 1,2 then 3,4')).toEqual([
      { kind: 'text', text: 'go ' },
      { kind: 'coord', text: '1,2', x: 1, y: 2 },
      { kind: 'text', text: ' then ' },
      { kind: 'coord', text: '3,4', x: 3, y: 4 },
    ]);
  });

  it('leaves a thousands separator as plain text', () => {
    expect(splitChatCoordinates('I have 1,000 cash')).toEqual([
      { kind: 'text', text: 'I have 1,000 cash' },
    ]);
  });

  it('never returns an empty segment', () => {
    for (const seg of splitChatCoordinates('120,340')) {
      expect(seg.text.length).toBeGreaterThan(0);
    }
  });
});
