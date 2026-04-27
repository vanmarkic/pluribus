/**
 * RTK Query slice for email server data.
 *
 * Owns the cache for emails, bodies, and attachments. UI-only state
 * (selection, focus, filter) lives in `emailUiStore`.
 *
 * Patterns demonstrated:
 *   - Custom IPC base query (`ipcBaseQuery`)
 *   - Tag-based invalidation: `Email` (per-id) + `LIST` (all)
 *   - Optimistic updates via `onQueryStarted` + `updateQueryData`
 *   - Page-merging infinite list via `serializeQueryArgs` + `merge`
 */

import { createApi } from '@reduxjs/toolkit/query/react';
import type {
  Attachment,
  Email,
  EmailBody,
  ListEmailsOptions,
} from '../../core/domain';
import { ipcBaseQuery } from './baseQuery';

type Patch = { undo: () => void };

export type ListEmailsArg = {
  accountId: number;
  folderPath?: string | undefined;
  unreadOnly?: boolean | undefined;
  starredOnly?: boolean | undefined;
  searchQuery?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

const LIST_TAG = { type: 'Email' as const, id: 'LIST' };

export const emailsApi = createApi({
  reducerPath: 'emailsApi',
  baseQuery: ipcBaseQuery,
  tagTypes: ['Email', 'EmailBody', 'EmailAttachments'],
  endpoints: (builder) => ({
    listEmails: builder.query<Email[], ListEmailsArg>({
      query: (arg) => (api) => {
        if (arg.searchQuery) {
          return api.emails.search(arg.searchQuery, arg.limit ?? 100, arg.accountId);
        }
        const opts: ListEmailsOptions = {
          accountId: arg.accountId,
          limit: arg.limit ?? 100,
        };
        if (arg.folderPath !== undefined) opts.folderPath = arg.folderPath;
        if (arg.unreadOnly !== undefined) opts.unreadOnly = arg.unreadOnly;
        if (arg.starredOnly !== undefined) opts.starredOnly = arg.starredOnly;
        if (arg.offset !== undefined) opts.offset = arg.offset;
        return api.emails.list(opts);
      },
      // Cache key ignores `offset` so successive pages merge into one entry.
      serializeQueryArgs: ({ queryArgs }) => {
        const { offset: _offset, ...rest } = queryArgs;
        return rest;
      },
      merge: (currentCache, newItems, { arg }) => {
        if (!arg.offset || arg.offset === 0) {
          return newItems;
        }
        const seen = new Set(currentCache.map((e) => e.id));
        for (const email of newItems) {
          if (!seen.has(email.id)) currentCache.push(email);
        }
        return currentCache;
      },
      forceRefetch: ({ currentArg, previousArg }) => {
        return currentArg?.offset !== previousArg?.offset;
      },
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'Email' as const, id })),
              LIST_TAG,
            ]
          : [LIST_TAG],
    }),

    getEmail: builder.query<Email | null, number>({
      query: (id) => (api) => api.emails.get(id),
      providesTags: (_result, _err, id) => [{ type: 'Email', id }],
    }),

    getEmailBody: builder.query<EmailBody, number>({
      query: (id) => (api) => api.emails.getBody(id),
      providesTags: (_result, _err, id) => [{ type: 'EmailBody', id }],
    }),

    getEmailAttachments: builder.query<Attachment[], number>({
      query: (emailId) => (api) => api.attachments.getForEmail(emailId),
      providesTags: (_result, _err, emailId) => [
        { type: 'EmailAttachments', id: emailId },
      ],
    }),

    markRead: builder.mutation<void, { id: number; isRead: boolean; listArg?: ListEmailsArg }>({
      query: ({ id, isRead }) => (api) => api.emails.markRead(id, isRead),
      onQueryStarted: async ({ id, isRead, listArg }, { dispatch, queryFulfilled }) => {
        const patches: Patch[] = [];
        if (listArg) {
          patches.push(
            dispatch(
              emailsApi.util.updateQueryData('listEmails', listArg, (draft) => {
                const target = draft.find((e) => e.id === id);
                if (target) target.isRead = isRead;
              }),
            ),
          );
        }
        patches.push(
          dispatch(
            emailsApi.util.updateQueryData('getEmail', id, (draft) => {
              if (draft) draft.isRead = isRead;
            }),
          ),
        );
        try {
          await queryFulfilled;
        } catch {
          patches.forEach((p) => p.undo());
        }
      },
      invalidatesTags: (_r, error, { id }) =>
        error ? [{ type: 'Email', id }] : [],
    }),

    setStarred: builder.mutation<void, { id: number; isStarred: boolean; listArg?: ListEmailsArg }>({
      query: ({ id, isStarred }) => (api) => api.emails.star(id, isStarred),
      onQueryStarted: async ({ id, isStarred, listArg }, { dispatch, queryFulfilled }) => {
        const patches: Patch[] = [];
        if (listArg) {
          patches.push(
            dispatch(
              emailsApi.util.updateQueryData('listEmails', listArg, (draft) => {
                const target = draft.find((e) => e.id === id);
                if (target) target.isStarred = isStarred;
              }),
            ),
          );
        }
        patches.push(
          dispatch(
            emailsApi.util.updateQueryData('getEmail', id, (draft) => {
              if (draft) draft.isStarred = isStarred;
            }),
          ),
        );
        try {
          await queryFulfilled;
        } catch {
          patches.forEach((p) => p.undo());
        }
      },
      invalidatesTags: (_r, error, { id }) =>
        error ? [{ type: 'Email', id }] : [],
    }),

    archiveEmail: builder.mutation<void, { id: number; listArg?: ListEmailsArg }>({
      query: ({ id }) => (api) => api.emails.archive(id),
      onQueryStarted: async ({ id, listArg }, { dispatch, queryFulfilled }) => {
        const patch = listArg
          ? dispatch(
              emailsApi.util.updateQueryData('listEmails', listArg, (draft) => {
                const idx = draft.findIndex((e) => e.id === id);
                if (idx !== -1) draft.splice(idx, 1);
              }),
            )
          : null;
        try {
          await queryFulfilled;
        } catch {
          patch?.undo();
        }
      },
      invalidatesTags: () => [LIST_TAG],
    }),

    unarchiveEmail: builder.mutation<void, { id: number; listArg?: ListEmailsArg }>({
      query: ({ id }) => (api) => api.emails.unarchive(id),
      onQueryStarted: async ({ id, listArg }, { dispatch, queryFulfilled }) => {
        const patch = listArg
          ? dispatch(
              emailsApi.util.updateQueryData('listEmails', listArg, (draft) => {
                const idx = draft.findIndex((e) => e.id === id);
                if (idx !== -1) draft.splice(idx, 1);
              }),
            )
          : null;
        try {
          await queryFulfilled;
        } catch {
          patch?.undo();
        }
      },
      invalidatesTags: () => [LIST_TAG],
    }),

    trashEmail: builder.mutation<void, { id: number; listArg?: ListEmailsArg }>({
      query: ({ id }) => (api) => api.emails.trash(id),
      onQueryStarted: async ({ id, listArg }, { dispatch, queryFulfilled }) => {
        const patch = listArg
          ? dispatch(
              emailsApi.util.updateQueryData('listEmails', listArg, (draft) => {
                const idx = draft.findIndex((e) => e.id === id);
                if (idx !== -1) draft.splice(idx, 1);
              }),
            )
          : null;
        try {
          await queryFulfilled;
        } catch {
          patch?.undo();
        }
      },
      invalidatesTags: () => [LIST_TAG],
    }),

    bulkMarkRead: builder.mutation<void, { ids: number[]; isRead: boolean; listArg?: ListEmailsArg }>({
      query: ({ ids, isRead }) => (api) =>
        Promise.all(ids.map((id) => api.emails.markRead(id, isRead))).then(() => undefined),
      onQueryStarted: async ({ ids, isRead, listArg }, { dispatch, queryFulfilled }) => {
        const idSet = new Set(ids);
        const patch = listArg
          ? dispatch(
              emailsApi.util.updateQueryData('listEmails', listArg, (draft) => {
                for (const e of draft) if (idSet.has(e.id)) e.isRead = isRead;
              }),
            )
          : null;
        try {
          await queryFulfilled;
        } catch {
          patch?.undo();
        }
      },
      invalidatesTags: (_r, error, { ids }) =>
        error ? ids.map((id) => ({ type: 'Email' as const, id })) : [],
    }),

    bulkArchive: builder.mutation<void, { ids: number[]; listArg?: ListEmailsArg }>({
      query: ({ ids }) => (api) =>
        Promise.all(ids.map((id) => api.emails.archive(id))).then(() => undefined),
      onQueryStarted: async ({ ids, listArg }, { dispatch, queryFulfilled }) => {
        const idSet = new Set(ids);
        const patch = listArg
          ? dispatch(
              emailsApi.util.updateQueryData('listEmails', listArg, (draft) => {
                for (let i = draft.length - 1; i >= 0; i--) {
                  const item = draft[i];
                  if (item && idSet.has(item.id)) draft.splice(i, 1);
                }
              }),
            )
          : null;
        try {
          await queryFulfilled;
        } catch {
          patch?.undo();
        }
      },
      invalidatesTags: () => [LIST_TAG],
    }),

    bulkTrash: builder.mutation<void, { ids: number[]; listArg?: ListEmailsArg }>({
      query: ({ ids }) => (api) =>
        Promise.all(ids.map((id) => api.emails.trash(id))).then(() => undefined),
      onQueryStarted: async ({ ids, listArg }, { dispatch, queryFulfilled }) => {
        const idSet = new Set(ids);
        const patch = listArg
          ? dispatch(
              emailsApi.util.updateQueryData('listEmails', listArg, (draft) => {
                for (let i = draft.length - 1; i >= 0; i--) {
                  const item = draft[i];
                  if (item && idSet.has(item.id)) draft.splice(i, 1);
                }
              }),
            )
          : null;
        try {
          await queryFulfilled;
        } catch {
          patch?.undo();
        }
      },
      invalidatesTags: () => [LIST_TAG],
    }),

    downloadAttachment: builder.mutation<
      { path: string; action: string },
      { attachmentId: number; action?: 'open' | 'save' }
    >({
      query: ({ attachmentId, action }) => (api) =>
        api.attachments.download(attachmentId, action),
    }),
  }),
});

export const {
  useListEmailsQuery,
  useGetEmailQuery,
  useGetEmailBodyQuery,
  useGetEmailAttachmentsQuery,
  useMarkReadMutation,
  useSetStarredMutation,
  useArchiveEmailMutation,
  useUnarchiveEmailMutation,
  useTrashEmailMutation,
  useBulkMarkReadMutation,
  useBulkArchiveMutation,
  useBulkTrashMutation,
  useDownloadAttachmentMutation,
} = emailsApi;

export const invalidateEmailList = () => emailsApi.util.invalidateTags([LIST_TAG]);
