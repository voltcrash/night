<script lang="ts">
	import { onMount } from 'svelte';
	import { Bold, Braces, Code2, FileText, HardDrive, Heading2, Highlighter, Italic, Link, List, ListChecks, ListOrdered, LoaderCircle, Lock, LockOpen, LogOut, MessageSquareWarning, Minus, PanelLeftClose, Plus, Quote, Search, Settings, Sigma, Strikethrough, Wrench, X } from '@lucide/svelte';
	import { formatShortcut, type GithubUser, type KeyboardShortcuts, type PrimaryModifier, type VaultDescriptor, type VaultSearchResult } from '$lib';
	import GithubIcon from './github-icon.svelte';
	import VaultSwitcher from './vault-switcher.svelte';
	import type { GithubState, SaveState, TransferState } from './app-types';

	interface Props {
		vaults: VaultDescriptor[];
		activeVaultId: string;
		activeNoteId: string;
		results: VaultSearchResult[];
		visibleResults: VaultSearchResult[];
		searchQuery: string;
		notePage: number;
		notePageCount: number;
		saveState: SaveState;
		notesLoaded: boolean;
		transferState: TransferState;
		paletteOpen: boolean;
		settingsOpen: boolean;
		isOnline: boolean;
		githubState: GithubState;
		githubUser?: GithubUser;
		githubMessage: string;
		shortcuts: KeyboardShortcuts;
		primaryModifier: PrimaryModifier;
		storageError: string;
		renderedPaneVisible: boolean;
		renderedReadOnly: boolean;
		wordCount: number;
		readingMinutes: number;
		contentWidth: number;
		searchInput?: HTMLInputElement;
		noteList?: HTMLElement;
		onToggleSidebar: () => void;
		onSelectVault: (id: string) => void;
		onCreateVault: () => void;
		onRenameVault: (id: string, name: string) => void;
		onCreateNote: () => void;
		onSearch: (value: string) => void;
		onOpenPalette: () => void;
		onOpenSettings: () => void;
		onDisconnectGithub: () => void;
		onMoveNoteFocus: (event: KeyboardEvent) => void;
		onSelectNote: (id: string) => void;
		onChangePage: (page: number) => void;
		onInsertSyntax: (before: string, after?: string, placeholder?: string) => void;
		onPrefixLine: (prefix: string) => void;
		onToggleRenderedReadOnly: () => void;
		onContentWidthChange: (value: number) => void;
	}

	let {
		vaults, activeVaultId, activeNoteId, results, visibleResults, searchQuery, notePage, notePageCount, saveState, notesLoaded, paletteOpen, settingsOpen,
		isOnline, githubState, githubUser, githubMessage, transferState, storageError, shortcuts, primaryModifier, renderedPaneVisible, renderedReadOnly, wordCount, readingMinutes, contentWidth,
		searchInput = $bindable(), noteList = $bindable(), onToggleSidebar, onSelectVault, onCreateVault, onRenameVault, onCreateNote, onSearch,
		onOpenPalette, onOpenSettings, onDisconnectGithub, onMoveNoteFocus, onSelectNote, onChangePage,
		onInsertSyntax, onPrefixLine, onToggleRenderedReadOnly, onContentWidthChange
	}: Props = $props();

	let sidebarView = $state<'files' | 'tools'>('files');

	// The sidebar is a drawer on narrow screens, where the tools are the harder pane to reach.
	onMount(() => {
		if (globalThis.matchMedia?.('(max-width: 900px)').matches) sidebarView = 'tools';
	});
</script>

<aside class="sidebar" aria-label="Notes">
	<div class="notes-heading"><div class="notes-title"><button class="new-note" aria-label="New note" title="New note" disabled={transferState === 'working'} onclick={onCreateNote}><Plus size={17} /></button><VaultSwitcher {vaults} {activeVaultId} disabled={transferState === 'working'} {onSelectVault} {onCreateVault} {onRenameVault} /></div><div class="notes-actions"><button class="icon-button sidebar-toggle" aria-label="Hide notes sidebar" title={`Toggle sidebar (${formatShortcut(shortcuts.toggleSidebar, primaryModifier)})`} onclick={onToggleSidebar}><PanelLeftClose size={19} /></button></div></div>
	<div class="sidebar-switcher" role="tablist" aria-label="Sidebar view">
		<button role="tab" aria-selected={sidebarView === 'files'} class:active={sidebarView === 'files'} onclick={() => (sidebarView = 'files')}><FileText size={14} /> Files</button>
		<button role="tab" aria-selected={sidebarView === 'tools'} class:active={sidebarView === 'tools'} onclick={() => (sidebarView = 'tools')}><Wrench size={14} /> Tools</button>
	</div>
	{#if sidebarView === 'files'}
		<div class="sidebar-panel files-panel" role="tabpanel">
			<label class="search-box"><Search size={15} /><input bind:this={searchInput} type="search" placeholder="Search all notes" value={searchQuery} oninput={(event) => onSearch(event.currentTarget.value)} /><button type="button" aria-label="Open the command palette" aria-haspopup="dialog" aria-expanded={paletteOpen} aria-controls="command-palette" title={`Run a command (${formatShortcut(shortcuts.commandPalette, primaryModifier)})`} onclick={onOpenPalette}><kbd>{formatShortcut(shortcuts.commandPalette, primaryModifier).replaceAll(' ', '')}</kbd></button></label>
			<div class="result-count" aria-live="polite">{searchQuery ? `${results.length} ${results.length === 1 ? 'result' : 'results'}` : `${results.length} ${results.length === 1 ? 'note' : 'notes'}`}</div>
			<nav class="note-list" bind:this={noteList}>
				{#each visibleResults as result (result.note.id)}
					<button class="file" class:active={result.note.id === activeNoteId} aria-current={result.note.id === activeNoteId ? 'true' : undefined} disabled={transferState === 'working'} onkeydown={onMoveNoteFocus} onclick={() => onSelectNote(result.note.id)}>
						<FileText size={16} /><span><strong>{result.note.title}</strong>{#if searchQuery}<small>{result.excerpt || 'Title match'}</small>{/if}</span>{#if result.note.id === activeNoteId}<i></i>{/if}
					</button>
				{:else}
					{#if !notesLoaded && !storageError}
						<div class="empty-results"><LoaderCircle class="spin" size={20} /><strong>Opening your vault…</strong><span>Notes are read from this device.</span></div>
					{:else if searchQuery}
						<div class="empty-results"><Search size={20} /><strong>No notes match “{searchQuery}”</strong><span>Search covers every title and every word.</span><button onclick={() => onSearch('')}><X size={13} /> Clear search</button></div>
					{:else}
						<div class="empty-results"><FileText size={20} /><strong>No notes yet</strong><span>Your first note is one keystroke away.</span><button onclick={onCreateNote}><Plus size={13} /> New note</button></div>
					{/if}
				{/each}
			</nav>
			{#if notePageCount > 1}
				<div class="note-pagination" aria-label="Note list pages">
					<button disabled={notePage === 0} onclick={() => onChangePage(notePage - 1)}>Previous</button>
					<span>Page {notePage + 1} of {notePageCount}</span>
					<button disabled={notePage === notePageCount - 1} onclick={() => onChangePage(notePage + 1)}>Next</button>
				</div>
			{/if}
		</div>
	{:else}
		<div class="sidebar-panel tools-panel" role="tabpanel">
			<section class="tool-section">
				<h2>View</h2>
				<div class="sidebar-view-options">
					<button class:active={renderedReadOnly} aria-pressed={renderedReadOnly} disabled={!renderedPaneVisible} onclick={onToggleRenderedReadOnly} aria-label={renderedReadOnly ? 'Enable page editing' : 'Turn on read-only'}>{#if renderedReadOnly}<Lock size={16} />{:else}<LockOpen size={16} />{/if}<span>{renderedReadOnly ? 'Read only' : 'Editing'}</span></button>
					<label class="content-width-control">
						<span><strong>Content width</strong><output>{contentWidth}px</output></span>
						<input type="range" min="480" max="1200" step="20" value={contentWidth} aria-label="Content width" oninput={(event) => onContentWidthChange(Number(event.currentTarget.value))} />
					</label>
				</div>
			</section>
			<section class="tool-section">
				<h2>Formatting</h2>
				<div class="formatting-tools">
					<button onclick={() => onInsertSyntax('**', '**', 'bold text')} title={`Bold (${formatShortcut(shortcuts.bold, primaryModifier)})`} aria-label="Bold"><Bold size={17} /><span>Bold</span></button>
					<button onclick={() => onInsertSyntax('_', '_', 'italic text')} title={`Italic (${formatShortcut(shortcuts.italic, primaryModifier)})`} aria-label="Italic"><Italic size={17} /><span>Italic</span></button>
					<button onclick={() => onInsertSyntax('~~', '~~', 'struck text')} aria-label="Strikethrough"><Strikethrough size={17} /><span>Strike</span></button>
					<button onclick={() => onInsertSyntax('==', '==', 'highlighted text')} aria-label="Highlight"><Highlighter size={17} /><span>Highlight</span></button>
					<button onclick={() => onPrefixLine('## ')} aria-label="Heading"><Heading2 size={18} /><span>Heading</span></button>
					<button onclick={() => onPrefixLine('- ')} aria-label="Bulleted list"><List size={18} /><span>List</span></button>
					<button onclick={() => onPrefixLine('1. ')} aria-label="Numbered list"><ListOrdered size={18} /><span>Numbered</span></button>
					<button onclick={() => onPrefixLine('- [ ] ')} aria-label="Task list"><ListChecks size={18} /><span>Tasks</span></button>
					<button onclick={() => onPrefixLine('> ')} aria-label="Quote"><Quote size={17} /><span>Quote</span></button>
					<button onclick={() => onPrefixLine('> [!NOTE]\n> ')} aria-label="Callout"><MessageSquareWarning size={17} /><span>Callout</span></button>
					<button onclick={() => onInsertSyntax('`', '`', 'code')} aria-label="Inline code"><Code2 size={18} /><span>Code</span></button>
					<button onclick={() => onInsertSyntax('```\n', '\n```', 'code block')} aria-label="Code block"><Braces size={18} /><span>Code block</span></button>
					<button onclick={() => onInsertSyntax('[', '](https://)', 'link text')} aria-label="Link"><Link size={17} /><span>Link</span></button>
					<button onclick={() => onPrefixLine('---\n')} aria-label="Divider"><Minus size={18} /><span>Divider</span></button>
					<button onclick={() => onInsertSyntax('$$\n', '\n$$', 'equation')} aria-label="Display math"><Sigma size={18} /><span>Math</span></button>
				</div>
			</section>
			<section class="tool-section document-details">
				<h2>Document</h2>
				<div><span>Words</span><strong>{wordCount}</strong></div>
				<div><span>Reading time</span><strong>{readingMinutes} min</strong></div>
				<div><span>Status</span><strong>{saveState === 'loading' ? 'Opening' : saveState === 'error' ? 'Save failed' : 'Saved locally'}</strong></div>
			</section>
		</div>
	{/if}
	<div class="sidebar-footer">
		{#if githubState === 'connected' && githubUser}
			<div class="github-account" class:offline={!isOnline} title={isOnline ? `GitHub sync enabled as ${githubUser.login}` : `Signed in as ${githubUser.login}; sync is paused offline`}><span class="github-avatar" aria-hidden="true">{githubUser.login.slice(0, 1)}</span><span class="github-login">@{githubUser.login}</span><button aria-label="Turn off GitHub sync" title={isOnline ? 'Turn off GitHub sync' : 'GitHub sync is unavailable offline'} disabled={!isOnline} onclick={onDisconnectGithub}><LogOut size={14} /></button></div>
		{:else}
			<button class="github-connect" class:error={githubState === 'error'} title={githubMessage || 'Notes are saved on this device'} aria-label="Open local storage settings" onclick={onOpenSettings}><HardDrive size={16} /><span>Saved locally</span></button>
		{/if}
		<button class="icon-button" aria-label="Settings" aria-haspopup="dialog" aria-expanded={settingsOpen} aria-controls="settings-dialog" title="Settings" onclick={onOpenSettings}><Settings size={18} /></button>
	</div>
</aside>
