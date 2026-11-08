import type { WatchPlatform } from './generate.js';

/**
 * Known save folders, offered as presets in the generator. The scripts also look one folder deeper, so the
 * `SaveGames` folder itself works: the game keeps each account's saves in a sub-folder named after its Steam or Epic
 * ID. Checked against the Satisfactory wiki (satisfactory.wiki.gg, "Save files" and "Dedicated servers", 2026-11-08):
 * the Windows, Flatpak, Steam Deck and dedicated server paths are as listed there; for `~/.steam/steam/…` the wiki
 * gives `…/steamuser/Local Settings/Application Data/…`, a link in the Proton prefix to the `AppData/Local` used here.
 */
export type SavePreset = 'windows' | 'windowsServer' | 'proton' | 'flatpak' | 'steamDeck' | 'linuxServer';

export const SAVE_PRESETS: Record<SavePreset, string> = {
  windows: '%LOCALAPPDATA%\\FactoryGame\\Saved\\SaveGames',
  windowsServer: '%LOCALAPPDATA%\\FactoryGame\\Saved\\SaveGames\\server',
  proton: '~/.steam/steam/steamapps/compatdata/526870/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved/SaveGames',
  flatpak: '~/.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/compatdata/526870/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved/SaveGames',
  steamDeck: '/home/deck/.steam/root/steamapps/compatdata/526870/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved/SaveGames',
  linuxServer: '~/.config/Epic/FactoryGame/Saved/SaveGames/server',
};

/** The presets that fit a platform, the default first. Docker runs on a Linux host here (a dedicated server first). */
export const PRESETS_FOR: Record<WatchPlatform, readonly SavePreset[]> = {
  powershell: ['windows', 'windowsServer'],
  bash: ['proton', 'flatpak', 'steamDeck', 'linuxServer'],
  docker: ['linuxServer', 'proton', 'flatpak', 'steamDeck'],
};
