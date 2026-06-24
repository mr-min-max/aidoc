// The factory is kept as a thin re-export for backwards compatibility.
// New code should import createProvider/listProviders from ./registry.
export { createProvider, listProviders, registerProvider } from './registry';
export type { ProviderConfig, ProviderDefinition } from './registry';
