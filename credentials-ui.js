import { t } from './i18n.js';
import {
  CREDENTIAL_KEY, initializeCredentials, loadCredentials,
  saveCredentials, migrateCredentials, deleteCredentials, sameRecord
} from './credential-store.js';
import { STORE_KEY as LEGACY_KEY } from './credential-vault.js';

export class CredentialsUI {
  constructor() {
    this.state = 'loading';
    this.record = null;
    this.error = '';
    this.editing = false;
    this.pending = false;
    this.saving = false;
    this.listening = false;
    this.onChange = null;
    this.onAccepted = null;
    this.$ = id => document.getElementById(id);

    for (const [id, action] of [
      ['saveCredentials', () => this.save()],
      ['migrateCredentials', () => this.migrate()],
      ['replaceCredentials', () => this.replace()],
      ['cancelReplace', () => this.cancel()],
      ['deleteCredentials', () => this.remove()],
      ['retryCredentials', () => this.init()]
    ]) this.$(id).addEventListener('click', action);

    this.render();
  }

  clearFields() {
    for (const id of ['key', 'secret', 'legacyPassword'])
      this.$(id).value = '';
  }

  notice(message, error = false) {
    const element = this.$('credentialFeedback');
    element.hidden = false;
    element.className = 'feedback' + (error ? ' error' : '');
    element.textContent = String(message);
  }

  fail(error) {
    this.state = 'error';
    this.error = String(error?.message || error);
    this.notice(this.error, true);
    this.render();
  }

  async reload() {
    const saved = await loadCredentials();
    this.record = saved.record;
    this.state = saved.credentials ? 'ready' : saved.legacy ? 'legacy' : 'empty';
    this.error = '';
    this.render();
  }

  async init() {
    if (this.pending) return;
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
      await this.reload();
      if (!this.listening) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== 'local' || this.saving) return;
          const latest = changes[CREDENTIAL_KEY];
          if (latest && sameRecord(latest.newValue, this.record)) return;
          if (latest || changes[LEGACY_KEY])
            this.reload().catch(error => this.fail(error));
        });
        this.listening = true;
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.pending = false;
      this.render();
    }
  }

  render() {
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
    if (this.pending) return;
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
        this.$('legacyPassword').value = '';
        this.saving = false;
      }
    });
  }

  replace() {
    if (this.pending) return;
    this.editing = true;
    this.clearFields();
    this.$('credentialFeedback').hidden = true;
    this.render();
  }

  cancel() {
    if (this.pending) return;
    this.editing = false;
    this.clearFields();
    return this.reload().catch(error => this.fail(error));
  }

  remove() {
    if (!window.confirm(t('credentialsUiDeleteSavedApiKeys'))) return;
    return this.run(async () => {
      this.saving = true;
      try {
        await deleteCredentials();
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
