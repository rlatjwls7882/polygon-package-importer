import { createViewLifetime } from './lifetime.js';
import { t } from '../i18n.js';
import {
  CREDENTIAL_KEY, initializeCredentials, loadCredentials,
  saveCredentials, migrateCredentials, deleteCredentials, sameRecord
} from '../storage/credentials.js';
import { STORE_KEY as LEGACY_KEY } from '../storage/legacy-vault.js';

export class CredentialsUI {
  constructor() {
    this.lifetime = createViewLifetime();
    this.reloading = null; this.reloadRequested = false; this.recordVersion = 0;
    this.state = 'loading';
    this.record = null;
    this.error = '';
    this.editing = false;
    this.pending = false;
    this.saving = false;
    this.listening = false;
    this.onChange = null;
    this.onAccepted = null;
    const doc = document;
    this.$ = id => doc.getElementById(id);

    for (const [id, action] of [
      ['saveCredentials', () => this.save()],
      ['migrateCredentials', () => this.migrate()],
      ['replaceCredentials', () => this.replace()],
      ['cancelReplace', () => this.cancel()],
      ['deleteCredentials', () => this.remove()],
      ['retryCredentials', () => this.init()]
    ]) this.lifetime.listen(this.$(id), 'click', action);

    this.render();
  }

  clearFields() {
    if (this.lifetime.disposed) return;
    for (const id of ['key', 'secret', 'legacyPassword'])
      this.$(id).value = '';
  }

  notice(message, error = false) {
    if (this.lifetime.disposed) return;
    const element = this.$('credentialFeedback');
    element.hidden = false;
    element.className = 'feedback' + (error ? ' error' : '');
    element.textContent = String(message);
  }

  fail(error) {
    if (this.lifetime.disposed) return;
    this.state = 'error';
    this.error = String(error?.message || error);
    this.notice(this.error, true);
    this.render();
  }

  reload() {
    if (this.lifetime.disposed) return Promise.resolve();
    this.reloadRequested = true;
    if (this.reloading) return this.reloading;
    this.reloading = this.reloadLatest().finally(() => {
      this.reloading = null;
      if (this.reloadRequested && !this.lifetime.disposed) return this.reload();
    });
    return this.reloading;
  }

  async reloadLatest() {
    while (this.reloadRequested && !this.lifetime.disposed) {
      this.reloadRequested = false;
      const version = this.recordVersion;
      let saved;
      try {saved = await loadCredentials();}
      catch (error) {
        if (version !== this.recordVersion) this.reloadRequested = true;
        if (this.reloadRequested) continue;
        throw error;
      }
      if (this.lifetime.disposed) return;
      if (version !== this.recordVersion) this.reloadRequested = true;
      if (this.reloadRequested) continue; // Do not render an obsolete decrypt result.
      this.record = saved.record;
      this.state = saved.credentials ? 'ready' : saved.legacy ? 'legacy' : 'empty';
      this.error = '';
      this.render();
    }
  }

  dispose() {
    if (this.lifetime.disposed) return;
    this.clearFields();
    this.lifetime.dispose();
    this.reloadRequested = false;
    this.record = null;
    this.onChange = null; this.onAccepted = null;
  }

  async init() {
    if (this.pending || this.lifetime.disposed) return;
    this.pending = true;
    this.state = 'loading';
    this.editing = false;
    this.clearFields();
    this.$('credentialFeedback').hidden = true;
    this.render();
    try {
      if (typeof location !== 'undefined' && location.protocol !== 'chrome-extension:')
        throw Error(t('credentialsUiOpenThisPageFromTheChromeExtension'));
      await initializeCredentials();
      if (this.lifetime.disposed) return;
      if (!this.listening) {
        this.lifetime.subscribe(chrome.storage.onChanged, (changes, area) => {
          if (area !== 'local' || this.saving) return;
          const latest = changes[CREDENTIAL_KEY];
          if (latest && sameRecord(latest.newValue, this.record)) return;
          if (latest || changes[LEGACY_KEY])
            this.reload().catch(error => this.fail(error));
        });
        this.listening = true;
      }
      await this.reload();
    } catch (error) {
      this.fail(error);
    } finally {
      this.pending = false;
      this.render();
    }
  }

  render() {
    if (this.lifetime.disposed) return;
    const setup = this.state === 'empty' || this.editing;
    const legacy = this.state === 'legacy' && !this.editing;
    const canManage = ['ready', 'error'].includes(this.state) && !this.editing;
    this.$('credentialSetup').hidden = !setup;
    this.$('credentialMigration').hidden = !legacy;
    this.$('credentialManage').hidden = !canManage;
    this.$('credentialInitHelp').hidden = this.state !== 'error';
    this.$('cancelReplace').hidden = !this.editing;
    this.$('replaceCredentials').hidden = !canManage;
    const text = {
      loading: t('credentialsUiCheckingApiKeys'),
      empty: t('credentialsUiNoApiKeysSaved'),
      legacy: t('credentialsUiApiKeysFromAnOlderVersionWere'),
      ready: t('credentialsUiApiKeysSaved'),
      error: t('credentialsUiApiKeyError', this.error)
    };
    const status = this.$('credentialStatus');
    status.textContent = text[this.state];
    status.className = 'status-line' + (this.state === 'error' ? ' error' : '');
    for (const id of ['saveCredentials', 'migrateCredentials', 'replaceCredentials',
      'cancelReplace', 'deleteCredentials', 'retryCredentials', 'key', 'secret',
      'legacyPassword']) this.$(id).disabled = this.pending;
    this.onChange?.(this);
  }

  async run(action) {
    if (this.pending || this.lifetime.disposed) return;
    this.pending = true;
    this.render();
    try {
      await action();
    } catch (error) {
      this.notice(error?.message || error, true);
    } finally {
      this.pending = false;
      this.render();
    }
  }

  accept(saved, message) {
    if (this.lifetime.disposed) return;
    this.recordVersion++;
    this.record = saved.record;
    this.state = 'ready';
    this.editing = false;
    this.clearFields();
    this.notice(message);
    this.render();
    this.onAccepted?.();
  }

  save() {
    return this.run(async () => {
      this.saving = true;
      try {
        const credentials = {
          key:this.$('key').value,
          secret:this.$('secret').value
        };
        this.accept(await saveCredentials(credentials), t('credentialsUiApiKeysSaved2'));
      } finally {
        this.saving = false;
      }
    });
  }

  migrate() {
    return this.run(async () => {
      this.saving = true;
      try {
        const saved = await migrateCredentials(this.$('legacyPassword').value);
        this.accept(saved, t('credentialsUiPreviousApiKeysMigrated'));
      } finally {
        if (!this.lifetime.disposed) this.$('legacyPassword').value = '';
        this.saving = false;
      }
    });
  }

  replace() {
    if (this.pending || this.lifetime.disposed) return;
    this.editing = true;
    this.clearFields();
    this.$('credentialFeedback').hidden = true;
    this.render();
  }

  cancel() {
    if (this.pending || this.lifetime.disposed) return;
    this.editing = false;
    this.clearFields();
    return this.reload().catch(error => this.fail(error));
  }

  remove() {
    if (this.lifetime.disposed) return;
    if (!window.confirm(t('credentialsUiDeleteSavedApiKeys'))) return;
    return this.run(async () => {
      this.saving = true;
      try {
        await deleteCredentials();
        this.recordVersion++;
        this.record = null;
        this.state = 'empty';
        this.editing = false;
        this.clearFields();
        this.notice(t('credentialsUiApiKeysDeleted'));
      } catch (error) {
        await this.reload();
        throw error;
      } finally {
        this.saving = false;
      }
    });
  }
}
