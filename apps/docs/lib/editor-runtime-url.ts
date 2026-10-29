import runtime from '@/config/editor-demo-runtime.json';

export const runtimePackageUrl = `${runtime.cdnOrigin}/${runtime.runtimePackage}@${runtime.runtimeVersion}`;
export const runtimeCdnBaseUrl = `${runtimePackageUrl}/dist-cdn`;
