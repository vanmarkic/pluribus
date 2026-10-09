/**
 * A tiny change notifier for the config store.
 *
 * Some settings have an effect outside the store (launch at login registers a
 * login item with the OS). The IPC layer only calls `config.set`, so the
 * container wraps `set` with this to tell interested parties about the new
 * value, without the IPC handlers knowing who they are.
 */

export type ConfigChangeListener<V> = (value: V) => void;

export type ConfigEvents<Config> = {
  /** Listen for writes to one key. Returns an unsubscribe function. */
  onChange: <K extends keyof Config>(
    key: K,
    listener: ConfigChangeListener<Config[K]>,
  ) => () => void;
  /** Tell the listeners of `key` about its new value. A throwing listener never breaks the write. */
  emit: <K extends keyof Config>(key: K, value: Config[K]) => void;
};

export function createConfigEvents<Config>(
  onListenerError: (key: keyof Config, error: unknown) => void = () => {},
): ConfigEvents<Config> {
  const listeners = new Map<keyof Config, Set<ConfigChangeListener<never>>>();

  return {
    onChange(key, listener) {
      const set = listeners.get(key) ?? new Set();
      set.add(listener as ConfigChangeListener<never>);
      listeners.set(key, set);
      return () => {
        set.delete(listener as ConfigChangeListener<never>);
      };
    },

    emit(key, value) {
      for (const listener of [...(listeners.get(key) ?? [])]) {
        try {
          (listener as ConfigChangeListener<typeof value>)(value);
        } catch (error) {
          onListenerError(key, error);
        }
      }
    },
  };
}
