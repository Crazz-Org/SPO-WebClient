import { hasFacilityHint, parseFacilityDiagnosis } from './facility-diagnosis';

describe('hasFacilityHint', () => {
  it('is false for an empty, placeholder or denied section 2', () => {
    expect(hasFacilityHint(undefined)).toBe(false);
    expect(hasFacilityHint('')).toBe(false);
    expect(hasFacilityHint('   ')).toBe(false);
    expect(hasFacilityHint('No hints for this facility.')).toBe(false);
    expect(hasFacilityHint('This facility belongs to Crazz. There are no hints for you.')).toBe(false);
  });

  it('is true for any real sentence, including one paired with a section-1 stop', () => {
    expect(hasFacilityHint('Warning: This facility needs Qualified work force.')).toBe(true);
    expect(hasFacilityHint('There is nothing we can do about the weather but wait.')).toBe(true);
  });
});

describe('parseFacilityDiagnosis', () => {
  it('a stop in section 1 wins over any hint', () => {
    const d = parseFacilityDiagnosis('Stopped by SPO_test3.\nUpgrade Level: 2', 'No hints for this facility.');
    expect(d.severity).toBe('stop');
    expect(d.message).toBe('Stopped by SPO_test3.');
    expect(parseFacilityDiagnosis('Stopped: needs money.', 'Warning: This facility requires Cotton to produce.').severity).toBe('stop');
    expect(parseFacilityDiagnosis('Stopped due to weather conditions.', '').message).toContain('weather');
  });

  it('"No hints" and the guest denial mean nothing to show', () => {
    expect(parseFacilityDiagnosis('Upgrade Level: 1', 'No hints for this facility.').severity).toBe('none');
    expect(parseFacilityDiagnosis('', 'This facility belongs to Crazz. There are no hints for you.').severity).toBe('none');
    expect(parseFacilityDiagnosis(undefined, undefined).severity).toBe('none');
  });

  it('missing input → warning with a find-supplier action naming the fluid', () => {
    const d = parseFacilityDiagnosis('Upgrade Level: 2', 'Warning: This facility requires Cotton to produce. Hire some suppliers or try to overpay those you already have.');
    expect(d.severity).toBe('warning');
    expect(d.label).toBe('No supplies');
    expect(d.message).toBe('Needs Cotton to produce.');
    expect(d.action).toEqual({ kind: 'findSupplier', fluidName: 'Cotton' });
  });

  it('the generic "supplies" placeholder still yields a find-supplier action', () => {
    const d = parseFacilityDiagnosis('', 'Warning: This facility requires supplies to produce. Hire some suppliers or try to overpay those you already have.');
    expect(d.action).toEqual({ kind: 'findSupplier', fluidName: 'supplies' });
  });

  it('needs-more-supplies is a hint, workforce opens the workforce section, services open services', () => {
    expect(parseFacilityDiagnosis('', 'Hint: This facility needs more Cotton to produce Fabric.')).toMatchObject({ severity: 'hint', action: { kind: 'findSupplier', fluidName: 'Cotton' } });
    expect(parseFacilityDiagnosis('', 'Warning: This facility needs Middle class work force.')).toMatchObject({ severity: 'warning', label: 'Needs workers', action: { kind: 'openWorkforce', peopleKind: 'Middle class' } });
    expect(parseFacilityDiagnosis('', 'Warning: This facility is lacking services. Check the Services Tab on the INSPECT panel.')).toMatchObject({ severity: 'warning', action: { kind: 'openServices' } });
  });

  it('a two-sentence hint is read from its first sentence', () => {
    const d = parseFacilityDiagnosis('', 'Warning: This facility requires Cotton to produce. Hire some suppliers or try to overpay those you already have. Warning: This facility is lacking services. Check the Services Tab on the INSPECT panel.');
    expect(d.label).toBe('No supplies');
  });

  it('research, competition, residential, HQ, capitol, antenna, demolition', () => {
    expect(parseFacilityDiagnosis('', 'Warning: Cannot operate until you research again Robotics.')).toMatchObject({ severity: 'warning', action: { kind: 'openResearch' } });
    expect(parseFacilityDiagnosis('', 'Warning: You have a problem with competition. Get some advertisement.').label).toBe('Competition');
    expect(parseFacilityDiagnosis('', 'Congratulations: This building is working OK. Perhaps you can rise the rent a little bit.').severity).toBe('ok');
    expect(parseFacilityDiagnosis('', 'Warning: You need to attract more people to this building.').severity).toBe('warning');
    expect(parseFacilityDiagnosis('', 'Hint: You still can attract more people to this building.').severity).toBe('hint');
    expect(parseFacilityDiagnosis('', 'Hint: Go to "Settings" to carry out new researchs.').action).toEqual({ kind: 'openResearch' });
    expect(parseFacilityDiagnosis('', 'Hint: If you have more than 1000 prestige points you can launch your campaign for the presidency of Planitia.').label).toBe('Campaign');
    expect(parseFacilityDiagnosis('', 'WARNING: There are no antennas attached to this facility. Use the Connect button in the INSPECT panel to connect an antenna.').action).toEqual({ kind: 'connect' });
    expect(parseFacilityDiagnosis('', 'ATTENTION! THE MAYOR OF Helartia REQUESTED THE DEMOLITION OF THIS BUILDING DUE TO CITY PLANNING. DEMOLITION WILL TAKE PLACE IN 3 MONTHS.').severity).toBe('stop');
  });

  it('an unknown sentence keeps its text and takes the severity of its prefix', () => {
    expect(parseFacilityDiagnosis('', 'Warning: Something new from a future server.')).toMatchObject({ severity: 'warning', message: 'Something new from a future server.' });
    expect(parseFacilityDiagnosis('', 'Hint: Try this.')).toMatchObject({ severity: 'hint', message: 'Try this.' });
    expect(parseFacilityDiagnosis('', 'Congratulations: all good.')).toMatchObject({ severity: 'ok' });
    expect(parseFacilityDiagnosis('', 'This house was constructed by poor people that wanted to move to this town.')).toMatchObject({ severity: 'hint', label: 'Notice' });
  });

  it('tolerates the LF+CR line breaks the Delphi writer uses', () => {
    const d = parseFacilityDiagnosis('Stopped: needs money.\n\rUpgrade Level: 3', 'Hint: x\n\rHint: y');
    expect(d.severity).toBe('stop');
    expect(parseFacilityDiagnosis('', 'Hint: first\n\rHint: second').message).toBe('first');
  });

  it('knows every authored sentence (message builders)', () => {
    const cases: Array<[string, string]> = [
      ['Warning: Not enough company support. You must build more headquarters or attract more people to those already built.', 'Not enough company support'],
      ['Warning: You have a problem with competition. Get some advertisement.', 'Strong competition'],
      ['HINT: Use the "Connect" button in the INSPECT panel to connect this antenna to a station.', 'Connect this antenna'],
      ['WARNING! All facilities belonging to Crazz will disappear except this building. This may affect your facilities in this world.', 'All facilities of Crazz'],
      ['There is nothing we can do about the weather but wait.', 'Bad weather'],
      ['The facility started just few hours ago, there are no hints for now.', 'Just opened'],
      ['Warning: You need to attract more people to this building.', 'Needs many more tenants'],
      ['Hint: You need to attract more people to this building.', 'Could attract more tenants'],
      ['Hint: Try to attract more customers by offering better quality and prices.', 'Attract more customers'],
      ['Hint: Be sure there are enought workers to carry out the research.', 'enough workers'],
      ['Hint: Well, SPO_test3, this is a good time to go to Voyager\'s Mail and write a love letter...', 'Research under way'],
      ['Warning: Books service need more supplies.', 'Books service needs more supplies'],
      ['Hint: If you have more than 1000 prestige points you can launch your campaign for the presidency of Planitia.', '1000+ prestige'],
      ['ATTENTION! THE MAYOR OF Helartia REQUESTED THE DEMOLITION OF THIS BUILDING DUE TO CITY PLANNING.', 'mayor of Helartia'],
      ['Stopped: needs connections.', 'needs connections'],
    ];
    for (const [input, expected] of cases) {
      const d = input.startsWith('Stopped') ? parseFacilityDiagnosis(input, '') : parseFacilityDiagnosis('', input);
      expect(d.message).toContain(expected);
    }
  });

  it('an unprefixed unknown sentence is a notice; an ATTENTION! unknown is a stop', () => {
    expect(parseFacilityDiagnosis('', 'Something plain.')).toMatchObject({ severity: 'hint', label: 'Notice', message: 'Something plain.' });
    expect(parseFacilityDiagnosis('', 'ATTENTION! Something grave.')).toMatchObject({ severity: 'stop', message: 'Something grave.' });
    expect(parseFacilityDiagnosis('', 'HINT: shouted hint')).toMatchObject({ severity: 'hint', message: 'shouted hint' });
  });
});
