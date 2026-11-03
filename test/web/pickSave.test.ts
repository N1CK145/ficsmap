import { listSaves, sessionFromFileName, supportsFolderPicker } from '../../src/web/features/import/pickSave.js';

type FakeEntry = FakeFile | FakeDir;
interface FakeFile { kind: 'file'; name: string; getFile(): Promise<File> }
interface FakeDir { kind: 'directory'; name: string; values(): AsyncIterable<FakeEntry> }

const file = (name: string, lastModified: number): FakeFile => ({
  kind: 'file', name, getFile: async () => new File([], name, { lastModified }),
});
const dir = (name: string, entries: FakeEntry[]): FakeDir => ({
  kind: 'directory', name, values: async function* () { yield* entries; },
});

describe('sessionFromFileName', () => {
  it('drops the .sav extension and the date or autosave suffix', () => {
    expect(sessionFromFileName('Home Base_021126-222410.sav')).toBe('Home Base');
    expect(sessionFromFileName('Home Base_autosave_2.sav')).toBe('Home Base');
    expect(sessionFromFileName('My_World.sav')).toBe('My_World');
  });
});

describe('listSaves', () => {
  it('lists .sav files in the folder and one level of subfolders, newest first', async () => {
    const root = dir('SaveGames', [
      file('top_010126-000000.sav', 10),
      file('notes.txt', 99),
      dir('76561198000000000', [
        file('Alpha_021126-222410.sav', 30),
        file('Alpha_autosave_0.sav', 20),
        dir('deeper', [file('ignored.sav', 50)]),
      ]),
    ]);
    const list = await listSaves(root as unknown as FileSystemDirectoryHandle);
    expect(list.map(s => [s.name, s.session, s.modified])).toEqual([
      ['Alpha_021126-222410.sav', 'Alpha', 30],
      ['Alpha_autosave_0.sav', 'Alpha', 20],
      ['top_010126-000000.sav', 'top', 10],
    ]);
    expect(list[0]!.file).toBeInstanceOf(File);
  });
});

describe('supportsFolderPicker', () => {
  it('is false without showDirectoryPicker (jsdom)', () => {
    expect(supportsFolderPicker()).toBe(false);
  });
});
