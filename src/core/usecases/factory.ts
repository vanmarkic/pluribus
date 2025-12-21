/**
 * Use Cases Factory
 *
 * Creates all use cases with dependencies injected.
 * This is the composition root for use cases.
 */

import type { Deps } from '../ports';

// Import all use cases
import * as emailUseCases from './email-usecases';
import * as syncUseCases from './sync-usecases';
import * as classificationUseCases from './classification-usecases';
import * as accountUseCases from './account-usecases';
import * as draftUseCases from './draft-usecases';
import * as contactUseCases from './contact-usecases';
import * as databaseUseCases from './database-usecases';
import * as triageUseCases from './triage-usecases';
import * as awaitingUseCases from './awaiting';

/**
 * Create all use cases with dependencies
 */
export function createUseCases(deps: Deps) {
  return {
    // Emails
    listEmails: emailUseCases.listEmails(deps),
    getEmail: emailUseCases.getEmail(deps),
    getEmailBody: emailUseCases.getEmailBody(deps),
    searchEmails: emailUseCases.searchEmails(deps),
    markRead: emailUseCases.markRead(deps),
    starEmail: emailUseCases.starEmail(deps),
    archiveEmail: emailUseCases.archiveEmail(deps),
    unarchiveEmail: emailUseCases.unarchiveEmail(deps),
    deleteEmail: emailUseCases.deleteEmail(deps),
    trashEmail: emailUseCases.trashEmail(deps),

    // Remote Images
    loadRemoteImages: emailUseCases.loadRemoteImages(deps),
    hasLoadedRemoteImages: emailUseCases.hasLoadedRemoteImages(deps),
    getRemoteImagesSetting: emailUseCases.getRemoteImagesSetting(deps),
    setRemoteImagesSetting: emailUseCases.setRemoteImagesSetting(deps),
    clearImageCache: emailUseCases.clearImageCache(deps),
    clearAllImageCache: emailUseCases.clearAllImageCache(deps),
    autoLoadImagesForEmail: emailUseCases.autoLoadImagesForEmail(deps),

    // Sync
    syncMailbox: syncUseCases.syncMailbox(deps),
    syncAllMailboxes: syncUseCases.syncAllMailboxes(deps),
    syncWithAutoClassify: syncUseCases.syncWithAutoClassify(deps),
    syncAllWithAutoClassify: syncUseCases.syncAllWithAutoClassify(deps),
    cancelSync: syncUseCases.cancelSync(deps),

    // Classification
    classifyEmail: classificationUseCases.classifyEmail(deps),
    classifyAndApply: classificationUseCases.classifyAndApply(deps),
    classifyAndTriage: classificationUseCases.classifyAndTriage(deps),
    classifyNewEmails: classificationUseCases.classifyNewEmails(deps),

    // LLM Provider
    validateLLMProvider: classificationUseCases.validateLLMProvider(deps),
    listLLMModels: classificationUseCases.listLLMModels(deps),
    testLLMConnection: classificationUseCases.testLLMConnection(deps),
    isLLMConfigured: classificationUseCases.isLLMConfigured(deps),

    // Background Tasks
    startBackgroundClassification: classificationUseCases.startBackgroundClassification(deps),
    getBackgroundTaskStatus: classificationUseCases.getBackgroundTaskStatus(deps),
    clearBackgroundTask: classificationUseCases.clearBackgroundTask(deps),

    // AI Sort
    getPendingReviewQueue: classificationUseCases.getPendingReviewQueue(deps),
    getEmailsByPriority: classificationUseCases.getEmailsByPriority(deps),
    getFailedClassifications: classificationUseCases.getFailedClassifications(deps),
    getClassificationStats: classificationUseCases.getClassificationStats(deps),
    acceptClassification: classificationUseCases.acceptClassification(deps),
    dismissClassification: classificationUseCases.dismissClassification(deps),
    retryClassification: classificationUseCases.retryClassification(deps),
    reclassifyEmail: classificationUseCases.reclassifyEmail(deps),
    getClassificationState: classificationUseCases.getClassificationState(deps),
    getConfusedPatterns: classificationUseCases.getConfusedPatterns(deps),
    clearConfusedPatterns: classificationUseCases.clearConfusedPatterns(deps),
    getRecentActivity: classificationUseCases.getRecentActivity(deps),
    bulkAcceptClassifications: classificationUseCases.bulkAcceptClassifications(deps),
    bulkDismissClassifications: classificationUseCases.bulkDismissClassifications(deps),
    bulkMoveToFolder: classificationUseCases.bulkMoveToFolder(deps),
    getPendingReviewCount: classificationUseCases.getPendingReviewCount(deps),
    classifyUnprocessed: classificationUseCases.classifyUnprocessed(deps),

    // Accounts
    listAccounts: accountUseCases.listAccounts(deps),
    getAccount: accountUseCases.getAccount(deps),
    createAccount: accountUseCases.createAccount(deps),
    updateAccount: accountUseCases.updateAccount(deps),
    deleteAccount: accountUseCases.deleteAccount(deps),
    addAccount: accountUseCases.addAccount(deps),
    testImapConnection: accountUseCases.testImapConnection(deps),
    testSmtpConnection: accountUseCases.testSmtpConnection(deps),

    // Send
    sendEmail: accountUseCases.sendEmail(deps),
    replyToEmail: accountUseCases.replyToEmail(deps),
    forwardEmail: accountUseCases.forwardEmail(deps),

    // Drafts
    saveDraft: draftUseCases.saveDraft(deps),
    getDraft: draftUseCases.getDraft(deps),
    listDrafts: draftUseCases.listDrafts(deps),
    deleteDraft: draftUseCases.deleteDraft(deps),

    // Contacts
    getRecentContacts: contactUseCases.getRecentContacts(deps),
    searchContacts: contactUseCases.searchContacts(deps),
    recordContactUsage: contactUseCases.recordContactUsage(deps),

    // Database Health
    checkDatabaseIntegrity: databaseUseCases.checkDatabaseIntegrity(deps),
    createDatabaseBackup: databaseUseCases.createDatabaseBackup(deps),

    // Email Triage
    triageEmail: triageUseCases.triageEmail(deps),
    triageAndMoveEmail: triageUseCases.triageAndMoveEmail(deps),
    moveEmailToTriageFolder: triageUseCases.moveEmailToTriageFolder(deps),
    learnFromTriageCorrection: triageUseCases.learnFromTriageCorrection(deps),
    snoozeEmail: triageUseCases.snoozeEmail(deps),
    unsnoozeEmail: triageUseCases.unsnoozeEmail(deps),
    processSnoozedEmails: triageUseCases.processSnoozedEmails(deps),
    saveTrainingExample: triageUseCases.saveTrainingExample(deps),
    getTrainingExamples: triageUseCases.getTrainingExamples(deps),
    ensureTriageFolders: triageUseCases.ensureTriageFolders(deps),
    getSenderRules: triageUseCases.getSenderRules(deps),
    getTriageLog: triageUseCases.getTriageLog(deps),
    selectDiverseTrainingEmails: triageUseCases.selectDiverseTrainingEmails(deps),

    // Awaiting Reply
    shouldTrackAwaiting: awaitingUseCases.shouldTrackAwaiting({ llm: deps.llmGenerator }),
    markAwaiting: awaitingUseCases.markAwaiting(deps),
    clearAwaiting: awaitingUseCases.clearAwaiting(deps),
    clearAwaitingByReply: awaitingUseCases.clearAwaitingByReply(deps),
    getAwaitingList: awaitingUseCases.getAwaitingList(deps),
    toggleAwaiting: awaitingUseCases.toggleAwaiting(deps),
  };
}

export type UseCases = ReturnType<typeof createUseCases>;
