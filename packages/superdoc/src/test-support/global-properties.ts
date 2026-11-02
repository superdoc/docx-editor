import { createApp, type AppConfig, type ComponentCustomProperties } from 'vue';

export function globalPropertiesWith<Values extends object>(
  values: Values & Partial<ComponentCustomProperties>,
): AppConfig['globalProperties'] & Values {
  return Object.assign(createApp({}).config.globalProperties, values);
}
