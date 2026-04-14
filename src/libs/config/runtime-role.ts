export const APP_RUNTIME_ROLES = ['web', 'worker', 'all'] as const;

export type AppRuntimeRole = (typeof APP_RUNTIME_ROLES)[number];

function isAppRuntimeRole(value: string): value is AppRuntimeRole {
  return APP_RUNTIME_ROLES.includes(value as AppRuntimeRole);
}

export function parseAppRuntimeRole(
  value: string | undefined,
  nodeEnv: string,
): AppRuntimeRole {
  const defaultRole: AppRuntimeRole = nodeEnv === 'production' ? 'web' : 'all';
  const runtimeRole = value?.trim().toLowerCase() || defaultRole;

  if (!isAppRuntimeRole(runtimeRole)) {
    throw new Error(
      `Invalid APP_RUNTIME_ROLE "${runtimeRole}". Expected one of: ${APP_RUNTIME_ROLES.join(', ')}.`,
    );
  }

  if (nodeEnv === 'production' && runtimeRole === 'all') {
    throw new Error(
      'Invalid APP_RUNTIME_ROLE "all" in production. Use "web" for the HTTP service or "worker" for background processing.',
    );
  }

  return runtimeRole;
}

export function shouldServeHttp(appRuntimeRole: AppRuntimeRole): boolean {
  return appRuntimeRole !== 'worker';
}

export function shouldRunBackgroundWorkers(
  appRuntimeRole: AppRuntimeRole,
): boolean {
  return appRuntimeRole !== 'web';
}
