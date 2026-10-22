import auth from './locales/en/auth';
import common from './locales/en/common';
import crossWorkspace from './locales/en/crossWorkspace';
import gateway from './locales/en/gateway';
import sandboxes from './locales/en/sandboxes';
import workspaces from './locales/en/workspaces';

export const catalogs = {
  en: {
    common,
    auth,
    workspaces,
    gateway,
    crossWorkspace,
    sandboxes,
  },
} as const;
