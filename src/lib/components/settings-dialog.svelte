<script lang="ts">
	import { untrack } from 'svelte';
	import {
		CloudDownload, CloudOff, CloudUpload, Code2, Copy, Database, Download, ExternalLink, FileArchive,
		FolderInput, FolderOutput, HardDrive, LoaderCircle, LogOut, Monitor, Moon, RefreshCw, ShieldCheck,
		Sun, Trash2, TriangleAlert, WifiOff, X
	} from '@lucide/svelte';
	import {
		listGithubRepositories, type GithubBackupState, type GithubRepository, type GithubUser,
		defaultFontChoices, fontOptions, fontRoles,
		colorThemeOptions, formatShortcut, persistenceDeniedMessage, shortcutActions, shortcutFromEvent, shortcutParts, shortcutsEqual, type ColorTheme,
		type FontChoices, type FontRole,
		type KeyboardShortcut, type KeyboardShortcuts, type PrimaryModifier, type ResolvedTheme, type ShortcutAction, type ThemePreference,
		type Vault, type VaultStorageUsage
	} from '$lib';
	import { manageModalFocus } from '$lib/modal-focus';
	import GithubIcon from './github-icon.svelte';
	import type { SettingsSection } from './settings-types';

	interface Props {
		vault?: Vault;
		vaultName: string;
		suggestedRepositoryName: string;
		isOnline: boolean;
		githubUser?: GithubUser;
		githubState: 'loading' | 'connected' | 'disconnected' | 'error';
		githubMessage: string;
		githubBackup?: GithubBackupState;
		pendingBackupCount: number;
		backupState: 'idle' | 'backing-up' | 'success' | 'error';
		backupMessage: string;
		backupCommitUrl: string;
		transferState: 'idle' | 'working' | 'error';
		theme: ThemePreference;
		resolvedTheme: ResolvedTheme;
		colorTheme: ColorTheme;
		fonts: FontChoices;
		shortcuts: KeyboardShortcuts;
		primaryModifier: PrimaryModifier;
		section?: SettingsSection;
		onThemeChange: (preference: ThemePreference) => void;
		onColorThemeChange: (theme: ColorTheme) => void;
		onFontChange: (role: FontRole, id: string) => void;
		onResetFonts: () => void;
		onShortcutChange: (action: ShortcutAction, shortcut: KeyboardShortcut | null) => void;
		onResetShortcuts: () => void;
		onClose: () => void;
		onConnectGithub: () => void;
		onDisconnectGithub: () => void;
		onCreateRepository: (name: string) => void;
		onSelectRepository: (state: Omit<GithubBackupState, 'updatedAt'>) => void;
		onForgetRepository: () => void;
		onBackup: () => void;
		onRestore: () => void;
		onImportFolder: () => void;
		onImportZip: () => void;
		onExportFolder: () => void;
		onExportZip: () => void;
		onPrepareVaultDeletion: () => Promise<boolean>;
		onDeleteVault: () => Promise<void>;
	}

	let {
		vault, vaultName, suggestedRepositoryName, isOnline, githubUser, githubState, githubMessage, githubBackup, pendingBackupCount,
		backupState, backupMessage, backupCommitUrl, transferState, theme, resolvedTheme, colorTheme, fonts, shortcuts, primaryModifier,
		section = $bindable('editor'), onThemeChange, onColorThemeChange, onFontChange, onResetFonts, onShortcutChange, onResetShortcuts, onClose, onConnectGithub, onDisconnectGithub, onCreateRepository, onSelectRepository, onForgetRepository,
		onBackup, onRestore, onImportFolder, onImportZip, onExportFolder, onExportZip, onPrepareVaultDeletion, onDeleteVault
	}: Props = $props();

	const sections: Array<{ id: SettingsSection; label: string }> = [
		{ id: 'editor', label: 'Editor' },
		{ id: 'themes', label: 'Themes' },
		{ id: 'shortcuts', label: 'Keyboard shortcuts' },
		{ id: 'github', label: 'Backup & sync' },
		{ id: 'repository', label: 'Sync repository' },
		{ id: 'backup', label: 'Sync status' },
		{ id: 'storage', label: 'Storage choices' },
		{ id: 'transfer', label: 'Import & export' },
		{ id: 'vault', label: 'Vault' }
	];

	let repositories = $state<GithubRepository[]>([]);
	let repositoryState = $state<'idle' | 'loading' | 'error'>('idle');
	let repositoryMessage = $state('');
	let repositoriesLoaded = $state(false);
	let selectedRepository = $state('');
	let branch = $state('main');
	let directory = $state('vault');
	let newRepositoryName = $state(untrack(() => suggestedRepositoryName));
	let usage = $state<VaultStorageUsage>();
	let usageState = $state<'idle' | 'loading' | 'error'>('idle');
	let usageMessage = $state('');
	let persistState = $state<'idle' | 'requesting'>('idle');
	let nativeStorageState = $state<'idle' | 'connecting' | 'disconnecting'>('idle');
	let clearState = $state<'idle' | 'preparing' | 'confirming' | 'clearing' | 'error'>('idle');
	let clearMessage = $state('');
	let recordingShortcut = $state<ShortcutAction>();
	let shortcutMessage = $state('');

	const connected = $derived(githubState === 'connected' && Boolean(githubUser));
	const modeOptions: Array<{ id: ThemePreference; label: string; hint: string }> = [
		{ id: 'light', label: 'Light', hint: 'Warm paper for bright rooms.' },
		{ id: 'dark', label: 'Dark', hint: 'Low-glare onyx for night writing.' },
		{ id: 'system', label: 'System', hint: 'Follow your operating system automatically.' }
	];
	function themePreviewStyle(option: (typeof colorThemeOptions)[number]): string {
		return `--theme-preview-border: ${option.preview.border}; --theme-preview-paper: ${option.preview.paper}; --theme-preview-light: ${option.preview.light}; --theme-preview-dark: ${option.preview.dark}; --theme-preview-accent: ${option.preview.accent};`;
	}
	const fontsAreDefault = $derived(
		fontRoles.every(({ id }) => fonts[id] === defaultFontChoices[id])
	);
	const usedFraction = $derived(
		usage?.quota && usage.usage !== undefined ? Math.min(1, usage.usage / usage.quota) : 0
	);

	$effect(() => {
		if (section === 'repository' && connected && isOnline && !repositoriesLoaded) void loadRepositories();
		if (section === 'storage' && !usage && usageState === 'idle') void loadUsage();
	});

	$effect(() => {
		if (githubBackup) {
			selectedRepository = `${githubBackup.owner}/${githubBackup.repository}`;
			branch = githubBackup.branch;
			directory = githubBackup.directory;
		}
	});

	async function loadRepositories(): Promise<void> {
		if (!isOnline) return;
		repositoryState = 'loading';
		repositoryMessage = '';
		try {
			repositories = await listGithubRepositories();
			repositoriesLoaded = true;
			repositoryState = 'idle';
			if (repositories.length === 0) repositoryMessage = 'No repositories with write access were found.';
		} catch (error) {
			repositoryState = 'error';
			repositoryMessage = error instanceof Error ? error.message : 'Repositories could not be loaded.';
		}
	}

	async function loadUsage(): Promise<void> {
		if (!vault) return;
		usageState = 'loading';
		usageMessage = '';
		try {
			usage = await vault.getStorageUsage();
			usageState = 'idle';
		} catch (error) {
			usageState = 'error';
			usageMessage = error instanceof Error ? error.message : 'Storage usage is unavailable.';
		}
	}

	async function requestPersistence(): Promise<void> {
		if (!vault || persistState === 'requesting') return;
		persistState = 'requesting';
		try {
			const granted = await vault.requestPersistentStorage();
			await loadUsage();
			if (!granted) usageMessage = persistenceDeniedMessage();
		} finally {
			persistState = 'idle';
		}
	}

	async function connectNativeDirectory(): Promise<void> {
		if (!vault || nativeStorageState !== 'idle') return;
		nativeStorageState = 'connecting';
		usageMessage = '';
		try {
			await vault.connectNativeDirectory();
			await loadUsage();
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError')) {
				usageMessage = error instanceof Error ? error.message : 'The folder could not be connected.';
			}
		} finally {
			nativeStorageState = 'idle';
		}
	}

	async function disconnectNativeDirectory(): Promise<void> {
		if (!vault || nativeStorageState !== 'idle') return;
		nativeStorageState = 'disconnecting';
		usageMessage = '';
		try {
			await vault.disconnectNativeDirectory();
			await loadUsage();
		} catch (error) {
			usageMessage = error instanceof Error ? error.message : 'The folder could not be disconnected.';
		} finally {
			nativeStorageState = 'idle';
		}
	}

	function applyRepository(): void {
		const repository = repositories.find((item) => `${item.owner}/${item.name}` === selectedRepository);
		if (!repository) return;
		onSelectRepository({
			githubAccountId: githubUser!.id,
			githubAccountLogin: githubUser!.login,
			owner: repository.owner,
			repository: repository.name,
			branch: branch.trim() || repository.branch,
			directory: directory.trim().replace(/^\/+|\/+$/g, '')
		});
	}

	async function clearVault(): Promise<void> {
		if (!vault) return;
		if (clearState !== 'confirming') {
			clearState = 'preparing';
			clearMessage = '';
			if (!(await onPrepareVaultDeletion())) {
				clearState = 'error';
				clearMessage = 'Save the current note before deleting the vault.';
				return;
			}
			clearState = 'confirming';
			return;
		}
		clearState = 'clearing';
		clearMessage = '';
		try {
			await onDeleteVault();
			clearState = 'idle';
			usage = undefined;
		} catch (error) {
			clearState = 'error';
			clearMessage = error instanceof Error ? error.message : 'The vault could not be cleared.';
		}
	}

	function formatBytes(value?: number): string {
		if (value === undefined) return 'Unknown';
		if (value < 1024) return `${value} B`;
		const units = ['KB', 'MB', 'GB', 'TB'];
		let size = value / 1024;
		let unit = 0;
		while (size >= 1024 && unit < units.length - 1) {
			size /= 1024;
			unit += 1;
		}
		return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
	}

	function formatDate(value?: string): string {
		if (!value) return 'Never';
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
	}

	function beginShortcutCapture(action: ShortcutAction): void {
		recordingShortcut = action;
		shortcutMessage = '';
	}

	function captureShortcut(event: KeyboardEvent, action: ShortcutAction): void {
		event.preventDefault();
		event.stopPropagation();
		const shortcut = shortcutFromEvent(event, primaryModifier);
		if (!shortcut) return;
		const conflict = shortcutActions.find(({ id }) => id !== action && shortcutsEqual(shortcuts[id], shortcut));
		if (conflict) {
			shortcutMessage = `${formatShortcut(shortcut, primaryModifier)} is already assigned to ${conflict.label}.`;
			return;
		}
		onShortcutChange(action, shortcut);
		recordingShortcut = undefined;
		shortcutMessage = '';
	}

	function clearShortcut(action: ShortcutAction): void {
		onShortcutChange(action, null);
		recordingShortcut = undefined;
		shortcutMessage = '';
	}
</script>

<div class="modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget && clearState !== 'clearing') onClose(); }}>
	<div id="settings-dialog" class="shortcut-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1" use:manageModalFocus>
		<div class="modal-title">
			<div><span>Preferences</span><h2 id="settings-title">Settings</h2></div>
			<button class="icon-button" aria-label="Close settings" onclick={onClose}><X size={18} /></button>
		</div>

		<div class="settings-body">
			<nav class="settings-nav" aria-label="Settings sections">
				{#each sections as item (item.id)}
					<button class:active={section === item.id} aria-current={section === item.id ? 'page' : undefined} onclick={() => (section = item.id)}>{item.label}</button>
				{/each}
			</nav>

			<div class="settings-panel">
				{#if !isOnline && section !== 'editor' && section !== 'themes' && section !== 'shortcuts' && section !== 'storage' && section !== 'transfer' && section !== 'vault'}
					<div class="settings-banner"><WifiOff size={15} /><span>GitHub settings are paused until your connection returns.</span></div>
				{/if}

				{#if section === 'editor'}
					<div class="settings-section-heading">
						<div><h3>Editor</h3><p class="settings-hint">Set the typefaces your notes are written in</p></div>
						{#if !fontsAreDefault}<button class="settings-secondary" onclick={onResetFonts}>Restore default fonts</button>{/if}
					</div>

		<div class="type-specimen" aria-label="Typography preview">
			<div class="type-specimen-label">Preview</div>
			<h4>The <code class="type-specimen-token">?</code> Operator Shortcut</h4>
			<blockquote>“This pattern of propagating errors is so common in Rust that Rust provides the question mark operator <code class="type-specimen-token">?</code> to make this easier.”</blockquote>
			<div class="type-specimen-code" aria-label="Rust code example">
				<div class="type-specimen-code-header">
					<span><Code2 size={18} aria-hidden="true" /> Rust</span>
					<Copy size={24} aria-hidden="true" />
				</div>
				<pre><code><span class="type-specimen-code-keyword">let mut</span> <span class="type-specimen-code-variable">username_file</span> = <span class="type-specimen-code-type">File</span>::<span class="type-specimen-code-function">open</span>(<span class="type-specimen-code-string">"hello.txt"</span>)?;</code></pre>
			</div>
		</div>

					{#each fontRoles as role (role.id)}
						<div class="font-role">
							<label for={`font-${role.id}`}>{role.label}</label>
							<select id={`font-${role.id}`} aria-label={`${role.label} typeface`} value={fonts[role.id]} onchange={(event) => onFontChange(role.id, event.currentTarget.value)}>
								{#each fontOptions[role.id] as option (option.id)}
									<option value={option.id}>{option.name}</option>
								{/each}
							</select>
						</div>
					{/each}
				{:else if section === 'themes'}
					<h3>Themes</h3>
					<p class="settings-hint">Choose how Onyx looks in this browser.</p>
					<div class="theme-mode-options" role="radiogroup" aria-label="Color mode">
						{#each modeOptions as option (option.id)}
							<button class="theme-mode-option" class:active={theme === option.id} role="radio" aria-checked={theme === option.id} aria-label={option.label} onclick={() => onThemeChange(option.id)}>
								{#if option.id === 'light'}<Sun size={18} />{:else if option.id === 'dark'}<Moon size={18} />{:else}<Monitor size={18} />{/if}
								<span><strong>{option.label}</strong><small>{option.id === 'system' ? `${option.hint} (currently ${resolvedTheme}).` : option.hint}</small></span>
							</button>
						{/each}
					</div>
					<h4 class="theme-section-title">Color theme</h4>
					<div class="theme-options" role="radiogroup" aria-label="Color theme">
						{#each colorThemeOptions as option (option.id)}
							<button class:active={colorTheme === option.id} role="radio" aria-checked={colorTheme === option.id} onclick={() => onColorThemeChange(option.id)}>
								<span class="theme-preview" style={themePreviewStyle(option)} aria-hidden="true"><i></i><i></i><i></i></span>
								<span><strong>{option.label}</strong><small>{option.hint}</small></span>
							</button>
						{/each}
					</div>
				{:else if section === 'shortcuts'}
					<div class="settings-section-heading">
						<div><h3>Keyboard shortcuts</h3><p class="settings-hint">Select a shortcut, then press a new key combination. Your primary modifier is detected automatically.</p></div>
						<button class="settings-secondary" onclick={() => { onResetShortcuts(); recordingShortcut = undefined; shortcutMessage = ''; }}>Restore defaults</button>
					</div>
					{#if shortcutMessage}<p class="settings-hint error" role="alert">{shortcutMessage}</p>{/if}
					<div class="shortcut-list editable">
						{#each shortcutActions as action (action.id)}
							{@const shortcut = shortcuts[action.id]}
							<div>
								<span>{action.label}</span>
								<div class="shortcut-controls">
									<button
										class="shortcut-capture"
										class:recording={recordingShortcut === action.id}
										class:placeholder={recordingShortcut === action.id || !shortcut}
										aria-label={`Change ${action.label} shortcut`}
										onclick={() => beginShortcutCapture(action.id)}
										onkeydown={(event) => recordingShortcut === action.id && captureShortcut(event, action.id)}
										onblur={() => { if (recordingShortcut === action.id) recordingShortcut = undefined; }}
									>
										{#if recordingShortcut === action.id}
											Press keys…
										{:else if shortcut}
											{#each shortcutParts(shortcut, primaryModifier) as part, index}
												{#if primaryModifier === 'control' && index > 0}<span class="shortcut-separator">+</span>{/if}
												<kbd>{part}</kbd>
											{/each}
										{:else}
											Not set
										{/if}
									</button>
									<button class="shortcut-clear" aria-label={`Clear ${action.label} shortcut`} disabled={!shortcut} onclick={() => clearShortcut(action.id)}>Clear</button>
								</div>
							</div>
						{/each}
					</div>
				{:else if section === 'github'}
					<h3>Backup and sync with GitHub</h3>
					<p class="settings-hint">Sign-in is optional. It enables private backups that you can restore on another device; your working vault stays on this device.</p>
					{#if connected && githubUser}
						<div class="settings-account">
							<span class="github-avatar" aria-hidden="true">{githubUser.login.slice(0, 1)}</span>
							<span><strong>{githubUser.name || githubUser.login}</strong><small>@{githubUser.login}</small></span>
							<button disabled={!isOnline} onclick={onDisconnectGithub}><LogOut size={14} /> Disconnect</button>
						</div>
					{:else}
						<div class="settings-account empty">
							<CloudOff size={22} />
							<span><strong>Local only</strong><small>{githubMessage || 'Sign in to enable GitHub backup and cross-device sync.'}</small></span>
							<button class="settings-primary" disabled={!isOnline || githubState === 'loading'} onclick={onConnectGithub}>
								{#if githubState === 'loading'}<LoaderCircle class="spin" size={14} />{:else}<GithubIcon size={14} />{/if} Sign in with GitHub
							</button>
						</div>
					{/if}
				{:else if section === 'repository'}
					<h3>Sync repository</h3>
					{#if !connected}
						<p class="settings-hint">Sign in with GitHub to choose where this vault is backed up for cross-device restore.</p>
					{:else}
						<p class="settings-hint">“{vaultName}” backs up on its own. Only private repositories with write access can be used, and notes are written under the directory below.</p>
						<div class="settings-field">
							<label for="settings-repository">Repository</label>
							<div class="settings-row">
								<select id="settings-repository" bind:value={selectedRepository} disabled={repositoryState === 'loading' || repositories.length === 0}>
									<option value="" disabled>Select a repository</option>
									{#each repositories as repository (`${repository.owner}/${repository.name}`)}
										<option value={`${repository.owner}/${repository.name}`}>{repository.owner}/{repository.name}</option>
									{/each}
								</select>
								<button class="settings-ghost" aria-label="Reload repositories" disabled={!isOnline || repositoryState === 'loading'} onclick={() => void loadRepositories()}>
									{#if repositoryState === 'loading'}<LoaderCircle class="spin" size={14} />{:else}<RefreshCw size={14} />{/if}
								</button>
							</div>
						</div>
						<div class="settings-grid">
							<div class="settings-field"><label for="settings-branch">Branch</label><input id="settings-branch" bind:value={branch} autocomplete="off" /></div>
							<div class="settings-field"><label for="settings-directory">Directory</label><input id="settings-directory" bind:value={directory} autocomplete="off" placeholder="vault" /></div>
						</div>
						{#if repositoryMessage}<p class="settings-hint error">{repositoryMessage}</p>{/if}
						<div class="settings-actions">
							<button class="settings-primary" disabled={!isOnline || !selectedRepository} onclick={applyRepository}>Use this repository</button>
						</div>
						<div class="settings-separator"><span>or create a new one</span></div>
						<div class="settings-field">
							<label for="settings-new-repository">New private repository</label>
							<div class="settings-row">
								<div class="repository-field"><span>{githubUser?.login}/</span><input id="settings-new-repository" bind:value={newRepositoryName} pattern="[A-Za-z0-9._-]+" autocomplete="off" /></div>
								<button class="settings-primary" disabled={!isOnline || !newRepositoryName.trim()} onclick={() => onCreateRepository(newRepositoryName)}>Create and back up</button>
							</div>
						</div>
					{/if}
				{:else if section === 'backup'}
					<h3>Backup and sync status</h3>
					{#if !githubBackup}
						<p class="settings-hint">“{vaultName}” has no repository yet. Choose one in the Repository section to enable backups for this repository alone.</p>
					{:else}
						<dl class="settings-facts">
							<div><dt>Repository</dt><dd>{githubBackup.owner}/{githubBackup.repository}</dd></div>
							<div><dt>GitHub account</dt><dd>@{githubBackup.githubAccountLogin || 'Needs re-selection'}</dd></div>
							<div><dt>Branch</dt><dd>{githubBackup.branch}</dd></div>
							<div><dt>Directory</dt><dd>{githubBackup.directory || 'repository root'}</dd></div>
							<div><dt>Last backup</dt><dd>{formatDate(githubBackup.lastBackedUpAt)}</dd></div>
							<div><dt>Last commit</dt><dd>{githubBackup.lastCommitSha ? githubBackup.lastCommitSha.slice(0, 7) : 'None yet'}</dd></div>
							<div><dt>Pending changes</dt><dd>{pendingBackupCount === 0 ? 'Up to date' : `${pendingBackupCount} ${pendingBackupCount === 1 ? 'change' : 'changes'}`}</dd></div>
						</dl>
					{/if}
					{#if backupMessage}
						<p class="settings-hint" class:error={backupState === 'error'}>
							{backupMessage}
							{#if backupCommitUrl}<a href={backupCommitUrl} target="_blank" rel="noreferrer">View commit <ExternalLink size={12} /></a>{/if}
						</p>
					{/if}
					<div class="settings-actions">
						<button class="settings-primary" disabled={!isOnline || !connected || !vault || backupState === 'backing-up'} onclick={onBackup}>
							{#if backupState === 'backing-up'}<LoaderCircle class="spin" size={14} />{:else}<CloudUpload size={14} />{/if} Back up now
						</button>
						<button disabled={!isOnline || !connected || !vault} onclick={onRestore}><CloudDownload size={14} /> Restore a commit</button>
					</div>
				{:else if section === 'storage'}
					<h3>Storage choices</h3>
					<p class="settings-hint">Onyx always keeps a working vault on this device. Add a folder for accessible local files or GitHub for an off-device backup you can restore elsewhere.</p>
					{#if usageState === 'loading' && !usage}
						<p class="settings-hint"><LoaderCircle class="spin" size={14} /> Measuring vault storage…</p>
					{:else if usage}
						<div class="settings-meter" aria-label="Browser storage used">
							<div style={`width: ${Math.max(2, Math.round(usedFraction * 100))}%`}></div>
						</div>
						<p class="settings-hint">{formatBytes(usage.usage)} used{usage.quota ? ` of about ${formatBytes(usage.quota)} available to this site` : ''}.</p>
						<dl class="settings-facts">
							<div><dt>Notes</dt><dd>{usage.noteCount} · {formatBytes(usage.noteBytes)}</dd></div>
							<div><dt>Attachments</dt><dd>{usage.attachmentCount} · {formatBytes(usage.attachmentBytes)}</dd></div>
							<div><dt>Persistent storage</dt><dd>{usage.persistent ? 'Granted' : usage.persistentStorageAvailable ? 'Not granted' : 'Unavailable in this browser'}</dd></div>
							<div><dt>File storage</dt><dd>{usage.fileStorage.mode === 'native-directory' ? usage.fileStorage.nativeDirectoryName : 'Private browser storage (OPFS)'}</dd></div>
						</dl>
						<section class="settings-storage-option">
							<div><Database size={18} /><span><strong>Private browser storage</strong><small>The default for every vault. It works offline and does not need an account.</small></span></div>
							<p class="settings-hint">{usage.persistent ? 'This browser has granted protection from automatic storage cleanup.' : usage.persistentStorageAvailable ? 'The browser may remove this data when space is low unless persistent storage is granted.' : 'This browser cannot protect the vault from automatic storage cleanup.'}</p>
							{#if !usage.persistent && usage.persistentStorageAvailable}
								<div class="settings-actions"><button class="settings-primary" disabled={persistState === 'requesting'} onclick={() => void requestPersistence()}><ShieldCheck size={14} /> Request persistent storage</button></div>
							{/if}
						</section>
						<section class="settings-storage-option">
							<div><HardDrive size={18} /><span><strong>User-selected folder</strong><small>OPFS remains the fallback. Onyx mirrors notes and attachments into a folder you choose.</small></span></div>
							{#if usage.fileStorage.nativeDirectoryAvailable}
								{#if usage.fileStorage.nativeDirectoryPermission === 'granted'}
									<p class="settings-hint">Connected to <strong>{usage.fileStorage.nativeDirectoryName}</strong>. Disconnecting leaves its files in place and continues in OPFS.</p>
									<div class="settings-actions"><button disabled={nativeStorageState !== 'idle'} onclick={() => void disconnectNativeDirectory()}>Disconnect folder</button></div>
								{:else}
									<p class="settings-hint">{usage.fileStorage.nativeDirectoryName ? usage.fileStorage.nativeDirectoryPermission === 'error' ? `${usage.fileStorage.nativeDirectoryName} could not be updated. Onyx continues in OPFS; reconnect the folder to try again.` : `Access to ${usage.fileStorage.nativeDirectoryName} needs permission again. Until then, Onyx continues in OPFS.` : 'Choose a dedicated folder to keep accessible copies of this vault on your device.'}</p>
									<div class="settings-actions"><button class="settings-primary" disabled={nativeStorageState !== 'idle'} onclick={() => void connectNativeDirectory()}>{nativeStorageState === 'connecting' ? 'Connecting…' : usage.fileStorage.nativeDirectoryName ? 'Reconnect folder' : 'Choose folder'}</button></div>
								{/if}
							{:else}
								<p class="settings-hint">This browser does not expose a persistent user-selected folder. Use OPFS with Import & export or upload/download workflows.</p>
							{/if}
						</section>
						<section class="settings-storage-option">
							<div><CloudUpload size={18} /><span><strong>GitHub backup and sync</strong><small>Optional off-device history for restoring this vault on another device.</small></span></div>
							<p class="settings-hint">{connected ? githubBackup ? `Backing up to ${githubBackup.owner}/${githubBackup.repository}.` : 'Signed in. Choose a private repository to finish setup.' : 'Not enabled. Your local vault continues to work normally.'}</p>
							<div class="settings-actions"><button onclick={() => (section = connected ? githubBackup ? 'backup' : 'repository' : 'github')}>{connected ? githubBackup ? 'View sync status' : 'Choose repository' : 'Learn about GitHub sync'}</button></div>
						</section>
						<div class="settings-actions">
							<button disabled={usageState === 'loading'} onclick={() => void loadUsage()}><RefreshCw size={14} /> Refresh</button>
						</div>
					{/if}
					{#if usageMessage}<p class="settings-hint error">{usageMessage}</p>{/if}
				{:else if section === 'transfer'}
					<h3>Import & export</h3>
					<p class="settings-hint">Existing notes stay in your vault. Imported paths are retained for the next folder or ZIP export.</p>
					<div class="transfer-options">
						<section><div><FolderInput size={20} /><span><strong>Import folder</strong><small>Add every Markdown file and its attachments.</small></span></div><button disabled={!vault || transferState === 'working'} onclick={onImportFolder}>Choose folder</button></section>
						<section><div><FileArchive size={20} /><span><strong>Import ZIP</strong><small>Unpack a Markdown archive without flattening paths.</small></span></div><button disabled={!vault || transferState === 'working'} onclick={onImportZip}>Choose ZIP</button></section>
						<section><div><FolderOutput size={20} /><span><strong>Export folder</strong><small>Write notes and attachments into their original folders.</small></span></div><button disabled={!vault || transferState === 'working'} onclick={onExportFolder}>Choose folder</button></section>
						<section><div><Download size={20} /><span><strong>Export ZIP</strong><small>Download a portable archive of the entire vault.</small></span></div><button disabled={!vault || transferState === 'working'} onclick={onExportZip}>Download ZIP</button></section>
					</div>
				{:else}
					<h3>Vault management</h3>
					<div class="settings-danger">
						<div><Database size={18} /><span><strong>Forget the backup repository</strong><small>Onyx stops targeting {githubBackup ? `${githubBackup.owner}/${githubBackup.repository}` : 'any repository'}. Nothing on GitHub is deleted.</small></span></div>
						<button disabled={!githubBackup} onclick={onForgetRepository}>Forget</button>
					</div>
					<div class="settings-danger critical">
						<div><TriangleAlert size={18} /><span><strong>Delete every note on this device</strong><small>Notes and attachments are removed from this browser. A GitHub backup, if configured, keeps its history until the next backup.</small></span></div>
						<button class="danger" disabled={!vault || clearState === 'preparing' || clearState === 'clearing'} onclick={() => void clearVault()}>
							{#if clearState === 'preparing' || clearState === 'clearing'}<LoaderCircle class="spin" size={14} />{:else}<Trash2 size={14} />{/if}
							{clearState === 'preparing' ? 'Checking changes…' : clearState === 'confirming' ? 'Click to confirm' : 'Delete all notes'}
						</button>
					</div>
					{#if clearState === 'confirming'}<p class="settings-hint">{pendingBackupCount > 0 ? `${pendingBackupCount} pending ${pendingBackupCount === 1 ? 'change has' : 'changes have'} not been backed up to GitHub. ` : ''}This cannot be undone. Export a ZIP first if you want a copy.</p>{/if}
					{#if clearMessage}<p class="settings-hint error">{clearMessage}</p>{/if}
					<div class="settings-danger">
						<div><HardDrive size={18} /><span><strong>Local-first by design</strong><small>Everything above happens on this device. Onyx never uploads notes anywhere except the repository you choose.</small></span></div>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
