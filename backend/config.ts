
import { BotConfig } from "../types";
import { PRESETS } from "../constants";

export let ACTIVE_CONFIG: BotConfig = { ...PRESETS.OPTIMAL };

export function updateConfig(newConfig: BotConfig) {
  ACTIVE_CONFIG = { ...newConfig };
}
