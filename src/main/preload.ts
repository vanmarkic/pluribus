/**
 * Preload Script
 * 
 * Exposes a type-safe API to renderer process.
 * This is the only bridge between Node and browser.
 */

import { contextBridge, ipcRenderer } from 'electron';

// Event subscription tracking
type Callback = (...args: any[]) => void;
const listeners = new Map<string, Set<Callback>>();

// Forward events from main
['sync:progress', 'llm:classifying', 'llm:classified', 'llm:error'].forEach(channel => {
  ipcRenderer.on(channel, (_, data) => {
    listeners.get(channel)?.forEach(cb => cb(data));
  });
});

// API exposed to renderer
const api = {
  emails: {
    list: (opts = {}) => ipcRenderer.invoke('emails:list', opts),
    get: (id: number) => ipcRenderer.invoke('emails:get', id),
    getBody: (id: number) => ipcRenderer.invoke('emails:getBody', id),
    search: (query: string, limit?: number) => ipcRenderer.invoke('emails:search', query, limit),
    markRead: (id: number, isRead: boolean) => ipcRenderer.invoke('emails:markRead', id, isRead),
    star: (id: number, isStarred: boolean) => ipcRenderer.invoke('emails:star', id, isStarred),
    archive: (id: number) => ipcRenderer.invoke('emails:archive', id),
    delete: (id: number) => ipcRenderer.invoke('emails:delete', id),
  },

  attachments: {
    getForEmail: (emailId: number) => ipcRenderer.invoke('attachments:getForEmail', emailId),
    download: (attachmentId: number, action?: 'open' | 'save') =>
      ipcRenderer.invoke('attachments:download', attachmentId, action),
  },

  tags: {
    list: () => ipcRenderer.invoke('tags:list'),
    getForEmail: (emailId: number) => ipcRenderer.invoke('tags:getForEmail', emailId),
    apply: (emailId: number, tagId: number, source = 'manual') =>
      ipcRenderer.invoke('tags:apply', emailId, tagId, source),
    remove: (emailId: number, tagId: number) =>
      ipcRenderer.invoke('tags:remove', emailId, tagId),
    create: (tag: any) => ipcRenderer.invoke('tags:create', tag),
  },

  sync: {
    start: (accountId: number, opts = {}) => ipcRenderer.invoke('sync:start', accountId, opts),
    startAll: (opts = {}) => ipcRenderer.invoke('sync:startAll', opts),
  },

  llm: {
    classify: (emailId: number) => ipcRenderer.invoke('llm:classify', emailId),
    classifyAndApply: (emailId: number) => ipcRenderer.invoke('llm:classifyAndApply', emailId),
    getBudget: () => ipcRenderer.invoke('llm:getBudget'),
  },

  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    get: (id: number) => ipcRenderer.invoke('accounts:get', id),
    create: (account: any, password: string) => ipcRenderer.invoke('accounts:create', account, password),
    update: (id: number, updates: any, newPassword?: string) => ipcRenderer.invoke('accounts:update', id, updates, newPassword),
    delete: (id: number) => ipcRenderer.invoke('accounts:delete', id),
    testImap: (email: string, host: string, port: number) => ipcRenderer.invoke('accounts:testImap', email, host, port),
    testSmtp: (email: string, host: string, port: number) => ipcRenderer.invoke('accounts:testSmtp', email, host, port),
  },

  send: {
    email: (accountId: number, draft: any) => ipcRenderer.invoke('send:email', accountId, draft),
    reply: (emailId: number, body: any, replyAll?: boolean) => ipcRenderer.invoke('send:reply', emailId, body, replyAll),
    forward: (emailId: number, to: string[], body: any) => ipcRenderer.invoke('send:forward', emailId, to, body),
  },

  config: {
    get: (key: string) => ipcRenderer.invoke('config:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('config:set', key, value),
  },

  credentials: {
    setPassword: (account: string, password: string) => 
      ipcRenderer.invoke('credentials:setPassword', account, password),
    hasPassword: (account: string) => 
      ipcRenderer.invoke('credentials:hasPassword', account),
    deletePassword: (account: string) => 
      ipcRenderer.invoke('credentials:deletePassword', account),
    setApiKey: (service: string, key: string) => 
      ipcRenderer.invoke('credentials:setApiKey', service, key),
    hasApiKey: (service: string) => 
      ipcRenderer.invoke('credentials:hasApiKey', service),
  },

  security: {
    getConfig: () => ipcRenderer.invoke('security:getConfig'),
    setConfig: (updates: any) => ipcRenderer.invoke('security:setConfig', updates),
    clearSession: () => ipcRenderer.invoke('security:clearSession'),
    isBiometricAvailable: () => ipcRenderer.invoke('security:isBiometricAvailable'),
  },

  on: (channel: string, callback: Callback) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(callback);
  },

  off: (channel: string, callback: Callback) => {
    listeners.get(channel)?.delete(callback);
  },
};

contextBridge.exposeInMainWorld('mailApi', api);

export type MailAPI = typeof api;
