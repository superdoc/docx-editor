import { createApp, type AppConfig } from 'vue';

export function globalPropertiesWith(values: Record<string, unknown>): AppConfig['globalProperties'] {
  return Object.assign(createApp({}).config.globalProperties, values);
}
