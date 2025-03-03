import type { Endpoints } from '@octokit/types';
import { GitFileIndexStatus } from '../../../../git/models/file';
import type { IssueLabel, IssueOrPullRequestType } from '../../../../git/models/issue';
import { Issue } from '../../../../git/models/issue';
import type { PullRequestState } from '../../../../git/models/pullRequest';
import { PullRequest, PullRequestMergeableState, PullRequestReviewDecision } from '../../../../git/models/pullRequest';
import type { Provider } from '../../../../git/models/remoteProvider';

export interface GitHubBlame {
	ranges: GitHubBlameRange[];
	viewer?: string;
}

export interface GitHubMember {
	login: string;
	avatarUrl: string;
	url: string;
}

export interface GitHubBlameRange {
	startingLine: number;
	endingLine: number;
	commit: GitHubCommit;
}

export interface GitHubBranch {
	name: string;
	target: {
		oid: string;
		authoredDate: string;
		committedDate: string;
	};
}

export interface GitHubCommit {
	oid: string;
	parents: { nodes: { oid: string }[] };
	message: string;
	additions?: number | undefined;
	changedFiles?: number | undefined;
	deletions?: number | undefined;
	author: { avatarUrl: string | undefined; date: string; email: string | undefined; name: string };
	committer: { date: string; email: string | undefined; name: string };

	files?: Endpoints['GET /repos/{owner}/{repo}/commits/{ref}']['response']['data']['files'];
}

export interface GitHubCommitRef {
	oid: string;
}

export type GitHubContributor = Endpoints['GET /repos/{owner}/{repo}/contributors']['response']['data'][0];
export interface GitHubIssueOrPullRequest {
	id: string;
	nodeId: string;
	type: IssueOrPullRequestType;
	number: number;
	createdAt: string;
	closed: boolean;
	closedAt: string | null;
	title: string;
	url: string;
	state: GitHubPullRequestState;
}

export interface GitHubPagedResult<T> {
	pageInfo: GitHubPageInfo;
	totalCount: number;
	values: T[];
}
export interface GitHubPageInfo {
	startCursor?: string | null;
	endCursor?: string | null;
	hasNextPage: boolean;
	hasPreviousPage: boolean;
}

export type GitHubPullRequestState = 'OPEN' | 'CLOSED' | 'MERGED';
export interface GitHubPullRequest {
	author: {
		login: string;
		avatarUrl: string;
		url: string;
	};
	permalink: string;
	number: number;
	id: string;
	title: string;
	state: GitHubPullRequestState;
	updatedAt: string;
	closedAt: string | null;
	mergedAt: string | null;

	baseRefName: string;
	baseRefOid: string;
	baseRepository: {
		name: string;
		owner: {
			login: string;
		};
		url: string;
	};

	headRefName: string;
	headRefOid: string;
	headRepository: {
		name: string;
		owner: {
			login: string;
		};
		url: string;
	};

	repository: {
		isFork: boolean;
		owner: {
			login: string;
		};
	};

	isCrossRepository: boolean;
}

export interface GitHubIssueDetailed extends GitHubIssueOrPullRequest {
	date: Date;
	updatedAt: Date;
	author: GitHubMember;
	assignees: { nodes: GitHubMember[] };
	repository: {
		name: string;
		owner: {
			login: string;
		};
	};
	labels?: { nodes: IssueLabel[] };
	reactions?: {
		totalCount: number;
	};
	comments?: {
		totalCount: number;
	};
}

export type GitHubPullRequestReviewDecision = 'CHANGES_REQUESTED' | 'APPROVED' | 'REVIEW_REQUIRED';
export type GitHubPullRequestMergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';

export interface GitHubDetailedPullRequest extends GitHubPullRequest {
	reviewDecision: GitHubPullRequestReviewDecision;
	isReadByViewer: boolean;
	isDraft: boolean;
	checksUrl: string;
	totalCommentsCount: number;
	mergeable: GitHubPullRequestMergeableState;
	additions: number;
	deletions: number;
	reviewRequests: {
		nodes: {
			asCodeOwner: boolean;
			requestedReviewer: GitHubMember;
		}[];
	};
	assignees: {
		nodes: GitHubMember[];
	};
}

export function fromGitHubPullRequest(pr: GitHubPullRequest, provider: Provider): PullRequest {
	return new PullRequest(
		provider,
		{
			name: pr.author.login,
			avatarUrl: pr.author.avatarUrl,
			url: pr.author.url,
		},
		String(pr.number),
		pr.id,
		pr.title,
		pr.permalink,
		fromGitHubPullRequestState(pr.state),
		new Date(pr.updatedAt),
		pr.closedAt == null ? undefined : new Date(pr.closedAt),
		pr.mergedAt == null ? undefined : new Date(pr.mergedAt),
		undefined,
		{
			head: {
				exists: pr.headRepository != null,
				owner: pr.headRepository?.owner.login,
				repo: pr.baseRepository?.name,
				sha: pr.headRefOid,
				branch: pr.headRefName,
				url: pr.headRepository?.url,
			},
			base: {
				exists: pr.baseRepository != null,
				owner: pr.baseRepository?.owner.login,
				repo: pr.baseRepository?.name,
				sha: pr.baseRefOid,
				branch: pr.baseRefName,
				url: pr.baseRepository?.url,
			},
			isCrossRepository: pr.isCrossRepository,
		},
	);
}

export function fromGitHubPullRequestState(state: GitHubPullRequestState): PullRequestState {
	return state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : 'opened';
}

export function toGitHubPullRequestState(state: PullRequestState): GitHubPullRequestState {
	return state === 'merged' ? 'MERGED' : state === 'closed' ? 'CLOSED' : 'OPEN';
}

export function fromGitHubPullRequestReviewDecision(
	reviewDecision: GitHubPullRequestReviewDecision,
): PullRequestReviewDecision {
	switch (reviewDecision) {
		case 'APPROVED':
			return PullRequestReviewDecision.Approved;
		case 'CHANGES_REQUESTED':
			return PullRequestReviewDecision.ChangesRequested;
		case 'REVIEW_REQUIRED':
			return PullRequestReviewDecision.ReviewRequired;
	}
}

export function toGitHubPullRequestReviewDecision(
	reviewDecision: PullRequestReviewDecision,
): GitHubPullRequestReviewDecision {
	switch (reviewDecision) {
		case PullRequestReviewDecision.Approved:
			return 'APPROVED';
		case PullRequestReviewDecision.ChangesRequested:
			return 'CHANGES_REQUESTED';
		case PullRequestReviewDecision.ReviewRequired:
			return 'REVIEW_REQUIRED';
	}
}

export function fromGitHubPullRequestMergeableState(
	mergeableState: GitHubPullRequestMergeableState,
): PullRequestMergeableState {
	switch (mergeableState) {
		case 'MERGEABLE':
			return PullRequestMergeableState.Mergeable;
		case 'CONFLICTING':
			return PullRequestMergeableState.Conflicting;
		case 'UNKNOWN':
			return PullRequestMergeableState.Unknown;
	}
}

export function toGitHubPullRequestMergeableState(
	mergeableState: PullRequestMergeableState,
): GitHubPullRequestMergeableState {
	switch (mergeableState) {
		case PullRequestMergeableState.Mergeable:
			return 'MERGEABLE';
		case PullRequestMergeableState.Conflicting:
			return 'CONFLICTING';
		case PullRequestMergeableState.Unknown:
			return 'UNKNOWN';
	}
}

export function fromGitHubPullRequestDetailed(pr: GitHubDetailedPullRequest, provider: Provider): PullRequest {
	return new PullRequest(
		provider,
		{
			name: pr.author.login,
			avatarUrl: pr.author.avatarUrl,
			url: pr.author.url,
		},
		String(pr.number),
		pr.id,
		pr.title,
		pr.permalink,
		fromGitHubPullRequestState(pr.state),
		new Date(pr.updatedAt),
		pr.closedAt == null ? undefined : new Date(pr.closedAt),
		pr.mergedAt == null ? undefined : new Date(pr.mergedAt),
		fromGitHubPullRequestMergeableState(pr.mergeable),
		{
			head: {
				exists: pr.headRepository != null,
				owner: pr.headRepository?.owner.login,
				repo: pr.baseRepository?.name,
				sha: pr.headRefOid,
				branch: pr.headRefName,
				url: pr.headRepository?.url,
			},
			base: {
				exists: pr.baseRepository != null,
				owner: pr.baseRepository?.owner.login,
				repo: pr.baseRepository?.name,
				sha: pr.baseRefOid,
				branch: pr.baseRefName,
				url: pr.baseRepository?.url,
			},
			isCrossRepository: pr.isCrossRepository,
		},
		pr.isDraft,
		pr.additions,
		pr.deletions,
		pr.totalCommentsCount,
		fromGitHubPullRequestReviewDecision(pr.reviewDecision),
		pr.reviewRequests.nodes.map(r => ({
			isCodeOwner: r.asCodeOwner,
			reviewer: {
				name: r.requestedReviewer.login,
				avatarUrl: r.requestedReviewer.avatarUrl,
				url: r.requestedReviewer.url,
			},
		})),
		pr.assignees.nodes.map(r => ({
			name: r.login,
			avatarUrl: r.avatarUrl,
			url: r.url,
		})),
	);
}

export function fromGitHubIssueDetailed(value: GitHubIssueDetailed, provider: Provider): Issue {
	return new Issue(
		{
			id: provider.id,
			name: provider.name,
			domain: provider.domain,
			icon: provider.icon,
		},
		String(value.number),
		value.id,
		value.title,
		value.url,
		new Date(value.createdAt),
		value.closed,
		fromGitHubPullRequestState(value.state),
		new Date(value.updatedAt),
		{
			name: value.author.login,
			avatarUrl: value.author.avatarUrl,
			url: value.author.url,
		},
		{
			owner: value.repository.owner.login,
			repo: value.repository.name,
		},
		value.assignees.nodes.map(assignee => ({
			name: assignee.login,
			avatarUrl: assignee.avatarUrl,
			url: assignee.url,
		})),
		value.closedAt == null ? undefined : new Date(value.closedAt),
		value.labels?.nodes == null
			? undefined
			: value.labels.nodes.map(label => ({
					color: label.color,
					name: label.name,
			  })),
		value.comments?.totalCount,
		value.reactions?.totalCount,
	);
}

export interface GitHubTag {
	name: string;
	target: {
		oid: string;
		authoredDate?: string;
		committedDate?: string;
		message?: string | null;
		tagger?: {
			date: string;
		} | null;

		target?: {
			oid?: string;
			authoredDate?: string;
			committedDate?: string;
			message?: string | null;
		};
	};
}

export function fromCommitFileStatus(
	status: NonNullable<Endpoints['GET /repos/{owner}/{repo}/commits/{ref}']['response']['data']['files']>[0]['status'],
): GitFileIndexStatus | undefined {
	switch (status) {
		case 'added':
			return GitFileIndexStatus.Added;
		case 'changed':
		case 'modified':
			return GitFileIndexStatus.Modified;
		case 'removed':
			return GitFileIndexStatus.Deleted;
		case 'renamed':
			return GitFileIndexStatus.Renamed;
		case 'copied':
			return GitFileIndexStatus.Copied;
	}
	return undefined;
}
