import type { AuthenticationSessionsChangeEvent, CancellationToken, Event } from 'vscode';
import { authentication, Disposable, EventEmitter } from 'vscode';
import { isWeb } from '@env/platform';
import type { Container } from '../../container';
import type { SearchedIssue } from '../../git/models/issue';
import type { SearchedPullRequest } from '../../git/models/pullRequest';
import type { GitRemote } from '../../git/models/remote';
import type { RemoteProviderId } from '../../git/remotes/remoteProvider';
import { configuration } from '../../system/configuration';
import { debug } from '../../system/decorators/log';
import { filterMap, flatten } from '../../system/iterable';
import type {
	ProviderIntegration,
	ProviderKey,
	RepositoryDescriptor,
	SupportedHostedProviderIds,
	SupportedProviderIds,
	SupportedSelfHostedProviderIds,
} from './providerIntegration';
import { AzureDevOpsIntegration } from './providers/azureDevOps';
import { BitbucketIntegration } from './providers/bitbucket';
import { GitHubEnterpriseIntegration, GitHubIntegration } from './providers/github';
import { GitLabIntegration, GitLabSelfHostedIntegration } from './providers/gitlab';
import type { ProviderId } from './providers/models';
import { HostedProviderId, isSelfHostedProviderId, SelfHostedProviderId } from './providers/models';
import { ProvidersApi } from './providers/providersApi';

export interface ConnectionStateChangeEvent {
	key: string;
	reason: 'connected' | 'disconnected';
}

export class IntegrationService implements Disposable {
	private readonly _onDidChangeConnectionState = new EventEmitter<ConnectionStateChangeEvent>();
	get onDidChangeConnectionState(): Event<ConnectionStateChangeEvent> {
		return this._onDidChangeConnectionState.event;
	}

	private readonly _connectedCache = new Set<string>();
	private readonly _disposable: Disposable;
	private _integrations = new Map<ProviderKey, ProviderIntegration>();
	private _providersApi: ProvidersApi;

	constructor(private readonly container: Container) {
		this._providersApi = new ProvidersApi(container);

		this._disposable = Disposable.from(
			configuration.onDidChange(e => {
				if (configuration.changed(e, 'remotes')) {
					this._ignoreSSLErrors.clear();
				}
			}),
			authentication.onDidChangeSessions(this.onAuthenticationSessionsChanged, this),
		);
	}

	dispose() {
		this._disposable?.dispose();
	}

	private onAuthenticationSessionsChanged(e: AuthenticationSessionsChangeEvent) {
		for (const provider of this._integrations.values()) {
			if (e.provider.id === provider.authProvider.id) {
				provider.refresh();
			}
		}
	}

	connected(key: string): void {
		// Only fire events if the key is being connected for the first time
		if (this._connectedCache.has(key)) return;

		this._connectedCache.add(key);
		this.container.telemetry.sendEvent('remoteProviders/connected', { 'remoteProviders.key': key });

		setTimeout(() => this._onDidChangeConnectionState.fire({ key: key, reason: 'connected' }), 250);
	}

	disconnected(key: string): void {
		// Probably shouldn't bother to fire the event if we don't already think we are connected, but better to be safe
		// if (!_connectedCache.has(key)) return;
		this._connectedCache.delete(key);
		this.container.telemetry.sendEvent('remoteProviders/disconnected', { 'remoteProviders.key': key });

		setTimeout(() => this._onDidChangeConnectionState.fire({ key: key, reason: 'disconnected' }), 250);
	}

	isConnected(key?: string): boolean {
		return key == null ? this._connectedCache.size !== 0 : this._connectedCache.has(key);
	}

	get(id: SupportedHostedProviderIds): ProviderIntegration;
	get(id: SupportedSelfHostedProviderIds, domain: string): ProviderIntegration;
	get(id: SupportedHostedProviderIds | SupportedSelfHostedProviderIds, domain?: string): ProviderIntegration {
		const key = isSelfHostedProviderId(id) ? (`${id}:${domain}` as const) : id;
		let provider = this._integrations.get(key);
		if (provider == null) {
			switch (id) {
				case HostedProviderId.GitHub:
					provider = new GitHubIntegration(this.container, this._providersApi);
					break;
				case SelfHostedProviderId.GitHubEnterprise:
					if (domain == null) throw new Error(`Domain is required for '${id}' integration`);
					provider = new GitHubEnterpriseIntegration(this.container, this._providersApi, domain);
					break;
				case HostedProviderId.GitLab:
					provider = new GitLabIntegration(this.container, this._providersApi);
					break;
				case SelfHostedProviderId.GitLabSelfHosted:
					if (domain == null) throw new Error(`Domain is required for '${id}' integration`);
					provider = new GitLabSelfHostedIntegration(this.container, this._providersApi, domain);
					break;
				case HostedProviderId.Bitbucket:
					provider = new BitbucketIntegration(this.container, this._providersApi);
					break;
				case HostedProviderId.AzureDevOps:
					provider = new AzureDevOpsIntegration(this.container, this._providersApi);
					break;
				default:
					throw new Error(`Provider '${id}' is not supported`);
			}
			this._integrations.set(key, provider);
		}

		return provider;
	}

	getByRemote(remote: GitRemote): ProviderIntegration | undefined {
		if (remote?.provider == null) return undefined;

		switch (remote.provider.id) {
			case 'azure-devops':
				return this.get(HostedProviderId.AzureDevOps);
			case 'bitbucket':
				return this.get(HostedProviderId.Bitbucket);
			case 'github':
				if (remote.provider.custom && remote.provider.domain != null) {
					return this.get(SelfHostedProviderId.GitHubEnterprise, remote.provider.domain);
				}
				return this.get(HostedProviderId.GitHub);
			case 'gitlab':
				if (remote.provider.custom && remote.provider.domain != null) {
					return this.get(SelfHostedProviderId.GitLabSelfHosted, remote.provider.domain);
				}
				return this.get(HostedProviderId.GitLab);
			case 'bitbucket-server':
			default:
				return undefined;
		}
	}

	async getMyIssues(
		providerIds?: ProviderId[],
		cancellation?: CancellationToken,
	): Promise<SearchedIssue[] | undefined> {
		const providers: Map<ProviderIntegration, RepositoryDescriptor[] | undefined> = new Map();
		for (const integration of this._integrations.values()) {
			if (providerIds == null || providerIds.includes(integration.id)) {
				providers.set(integration, undefined);
			}
		}
		if (providers.size === 0) return undefined;

		return this.getMyIssuesCore(providers, cancellation);
	}

	private async getMyIssuesCore(
		providers: Map<ProviderIntegration, RepositoryDescriptor[] | undefined>,
		cancellation?: CancellationToken,
	): Promise<SearchedIssue[] | undefined> {
		const promises: Promise<SearchedIssue[] | undefined>[] = [];
		for (const [provider, repos] of providers) {
			if (provider == null) continue;

			promises.push(provider.searchMyIssues(repos, cancellation));
		}

		const results = await Promise.allSettled(promises);
		return [...flatten(filterMap(results, r => (r.status === 'fulfilled' ? r.value : undefined)))];
	}

	async getMyIssuesForRemotes(remote: GitRemote): Promise<SearchedIssue[] | undefined>;
	async getMyIssuesForRemotes(remotes: GitRemote[]): Promise<SearchedIssue[] | undefined>;
	@debug<IntegrationService['getMyIssuesForRemotes']>({
		args: { 0: (r: GitRemote | GitRemote[]) => (Array.isArray(r) ? r.map(rp => rp.name) : r.name) },
	})
	async getMyIssuesForRemotes(remoteOrRemotes: GitRemote | GitRemote[]): Promise<SearchedIssue[] | undefined> {
		if (!Array.isArray(remoteOrRemotes)) {
			remoteOrRemotes = [remoteOrRemotes];
		}

		if (!remoteOrRemotes.length) return undefined;
		if (remoteOrRemotes.length === 1) {
			const [remote] = remoteOrRemotes;
			if (remote?.provider == null) return undefined;

			const provider = this.getByRemote(remote);
			return provider?.searchMyIssues(remote.provider.repoDesc);
		}

		const providers = new Map<ProviderIntegration, RepositoryDescriptor[]>();

		for (const remote of remoteOrRemotes) {
			if (remote?.provider == null) continue;

			const integration = remote.getIntegration();
			if (integration == null) continue;

			let repos = providers.get(integration);
			if (repos == null) {
				repos = [];
				providers.set(integration, repos);
			}
			repos.push(remote.provider.repoDesc);
		}

		return this.getMyIssuesCore(providers);
	}

	async getMyPullRequests(
		providerIds?: ProviderId[],
		cancellation?: CancellationToken,
	): Promise<SearchedPullRequest[] | undefined> {
		const providers: Map<ProviderIntegration, RepositoryDescriptor[] | undefined> = new Map();
		for (const integration of this._integrations.values()) {
			if (providerIds == null || providerIds.includes(integration.id)) {
				providers.set(integration, undefined);
			}
		}
		if (providers.size === 0) return undefined;

		return this.getMyPullRequestsCore(providers, cancellation);
	}

	private async getMyPullRequestsCore(
		providers: Map<ProviderIntegration, RepositoryDescriptor[] | undefined>,
		cancellation?: CancellationToken,
	): Promise<SearchedPullRequest[] | undefined> {
		const promises: Promise<SearchedPullRequest[] | undefined>[] = [];
		for (const [provider, repos] of providers) {
			if (provider == null) continue;

			promises.push(provider.searchMyPullRequests(repos, cancellation));
		}

		const results = await Promise.allSettled(promises);
		return [...flatten(filterMap(results, r => (r.status === 'fulfilled' ? r.value : undefined)))];
	}

	async getMyPullRequestsForRemotes(remote: GitRemote): Promise<SearchedPullRequest[] | undefined>;
	async getMyPullRequestsForRemotes(remotes: GitRemote[]): Promise<SearchedPullRequest[] | undefined>;
	@debug<IntegrationService['getMyPullRequestsForRemotes']>({
		args: { 0: (r: GitRemote | GitRemote[]) => (Array.isArray(r) ? r.map(rp => rp.name) : r.name) },
	})
	async getMyPullRequestsForRemotes(
		remoteOrRemotes: GitRemote | GitRemote[],
	): Promise<SearchedPullRequest[] | undefined> {
		if (!Array.isArray(remoteOrRemotes)) {
			remoteOrRemotes = [remoteOrRemotes];
		}

		if (!remoteOrRemotes.length) return undefined;
		if (remoteOrRemotes.length === 1) {
			const [remote] = remoteOrRemotes;
			if (remote?.provider == null) return undefined;

			const provider = this.getByRemote(remote);
			return provider?.searchMyPullRequests(remote.provider.repoDesc);
		}

		const providers = new Map<ProviderIntegration, RepositoryDescriptor[]>();

		for (const remote of remoteOrRemotes) {
			if (remote?.provider == null) continue;

			const integration = remote.getIntegration();
			if (integration == null) continue;

			let repos = providers.get(integration);
			if (repos == null) {
				repos = [];
				providers.set(integration, repos);
			}
			repos.push(remote.provider.repoDesc);
		}

		return this.getMyPullRequestsCore(providers);
	}

	supports(remoteId: RemoteProviderId): boolean {
		switch (remoteId) {
			case 'azure-devops':
			case 'bitbucket':
			case 'github':
			case 'gitlab':
				return true;
			case 'bitbucket-server':
			default:
				return false;
		}
	}

	private _ignoreSSLErrors = new Map<string, boolean | 'force'>();
	ignoreSSLErrors(
		integration: ProviderIntegration | { id: SupportedProviderIds; domain?: string },
	): boolean | 'force' {
		if (isWeb) return false;

		let ignoreSSLErrors = this._ignoreSSLErrors.get(integration.id);
		if (ignoreSSLErrors === undefined) {
			const cfg = configuration
				.get('remotes')
				?.find(remote => remote.type.toLowerCase() === integration.id && remote.domain === integration.domain);
			ignoreSSLErrors = cfg?.ignoreSSLErrors ?? false;
			this._ignoreSSLErrors.set(integration.id, ignoreSSLErrors);
		}

		return ignoreSSLErrors;
	}
}
