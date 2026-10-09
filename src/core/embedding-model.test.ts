import { describe, it, expect } from 'vitest';
import { EmbeddingModelNotInstalledError, isEmbeddingModelNotInstalled } from './embedding-model';

describe('EmbeddingModelNotInstalledError', () => {
  it('is a typed Error that names the model and tells the user what to do', () => {
    const error = new EmbeddingModelNotInstalledError('Xenova/multilingual-e5-small');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(EmbeddingModelNotInstalledError);
    expect(error.name).toBe('EmbeddingModelNotInstalledError');
    expect(error.model).toBe('Xenova/multilingual-e5-small');
    expect(error.message).toMatch(/Xenova\/multilingual-e5-small is not installed/);
    expect(error.message).toMatch(/Download it in Settings/);
  });
});

describe('isEmbeddingModelNotInstalled', () => {
  it('recognises the error', () => {
    expect(isEmbeddingModelNotInstalled(new EmbeddingModelNotInstalledError('m'))).toBe(true);
  });

  it('recognises a copy of it by its code (another module instance, a wrapper)', () => {
    const copy = Object.assign(new Error('not installed'), {
      code: 'EMBEDDING_MODEL_NOT_INSTALLED',
    });
    expect(isEmbeddingModelNotInstalled(copy)).toBe(true);
    expect(isEmbeddingModelNotInstalled({ code: 'EMBEDDING_MODEL_NOT_INSTALLED' })).toBe(true);
  });

  it('does not take other failures for it', () => {
    expect(isEmbeddingModelNotInstalled(new Error('model not installed'))).toBe(false);
    expect(isEmbeddingModelNotInstalled(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(
      false,
    );
    expect(isEmbeddingModelNotInstalled('EMBEDDING_MODEL_NOT_INSTALLED')).toBe(false);
    expect(isEmbeddingModelNotInstalled(null)).toBe(false);
    expect(isEmbeddingModelNotInstalled(undefined)).toBe(false);
  });
});
