import { initI18n } from '../../src/web/app/i18n/index.js';
import { stepUse } from '../../src/web/features/planner/stepText.js';

describe('stepUse', () => {
  it('says the use with one decimal, never 100 % unless it is, in the factory\'s bands', () => {
    const en = initI18n(['en']);
    expect(stepUse({ machines: 52.5, machinesCeil: 53 }, 'en', en.t)).toMatchObject({ band: 'high', text: '99.1 %', long: 'Buildings used to 99.1 %' });
    expect(stepUse({ machines: 3, machinesCeil: 3 }, 'en', en.t)).toMatchObject({ band: 'full', text: '100 %' });
    expect(stepUse({ machines: 99.99, machinesCeil: 100 }, 'en', en.t)).toMatchObject({ band: 'high', text: '99.9 %' });
    expect(stepUse({ machines: 1.5, machinesCeil: 2 }, 'en', en.t)).toMatchObject({ band: 'throttled', text: '75 %' });
    expect(stepUse({ machines: 0, machinesCeil: 0 }, 'en', en.t)).toBeUndefined();
    const de = initI18n(['de']);
    expect(stepUse({ machines: 52.5, machinesCeil: 53 }, 'de', de.t)).toMatchObject({ text: '99,1 %', long: 'Gebäude zu 99,1 % ausgelastet' });
  });
});
