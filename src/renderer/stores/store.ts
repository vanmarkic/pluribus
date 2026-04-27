/**
 * Redux store wiring for the renderer.
 *
 * Server-side data lives in `emailsApi` (RTK Query). UI-only state
 * (selection, focus, filters) stays in Zustand stores. Both can coexist.
 */

import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { emailsApi } from './emailsApi';

export const store = configureStore({
  reducer: {
    [emailsApi.reducerPath]: emailsApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // Email rows arrive from IPC with `Date` instances. RTK Query caches
      // them as-is; the renderer only reads them. Skip the serializable
      // check on the cache path rather than coercing every row to ISO.
      serializableCheck: {
        ignoredPaths: [`${emailsApi.reducerPath}.queries`, `${emailsApi.reducerPath}.mutations`],
        ignoredActionPaths: ['payload', 'meta'],
      },
    }).concat(emailsApi.middleware),
});

setupListeners(store.dispatch);

export type AppStore = typeof store;
export type AppDispatch = typeof store.dispatch;
export type RootState = ReturnType<typeof store.getState>;
