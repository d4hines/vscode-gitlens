import { ProgressLocation, window } from 'vscode';
import type { Container } from '../../container';
import type { GitReference } from '../../git/models/reference';
import { getNameWithoutRemote, getReferenceLabel, isBranchReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import type { QuickPickItemOfT } from '../../quickpicks/items/common';
import { isStringArray } from '../../system/array';
import type { ViewsWithRepositoryFolders } from '../../views/viewBase';
import type {
	PartialStepState,
	QuickPickStep,
	StepGenerator,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import { canPickStepContinue, endSteps, QuickCommand, StepResultBreak } from '../quickCommand';
import {
	appendReposToTitle,
	inputBranchNameStep,
	pickBranchOrTagStepMultiRepo,
	pickRepositoriesStep,
} from '../quickCommand.steps';

interface Context {
	repos: Repository[];
	associatedView: ViewsWithRepositoryFolders;
	showTags: boolean;
	switchToLocalFrom: GitReference | undefined;
	title: string;
}

interface State {
	repos: string | string[] | Repository | Repository[];
	reference: GitReference;
	createBranch?: string;
	fastForwardTo?: GitReference;
}

type ConfirmationChoice = 'notjuicy';

type SwitchStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repos', string | string[] | Repository>;

export interface MarkAsNotJuicyGitCommandArgs {
	readonly command: 'notjuicy';
	confirm?: boolean;
	state?: Partial<State>;
}

export interface MarkAsNotJuicyCommandArgs {
    readonly command: 'notjuicy';
	state?: Partial<State>;
}

export class SwitchGitCommand extends QuickCommand<State> {
	constructor(container: Container, args?: MarkAsNotJuicyGitCommandArgs) {
		super(container, 'notjuicy', 'notjuiucy', 'Mark as Not Juicy', {
			description: 'foooooooooooooo',
		});

		let counter = 0;
		if (args?.state?.repos != null && (!Array.isArray(args.state.repos) || args.state.repos.length !== 0)) {
			counter++;
		}

		if (args?.state?.reference != null) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: args?.confirm,
			...args?.state,
		};
	}

	async execute(state: SwitchStepState) {
		await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Marking Commit FOOOOOO`,
			},
			() =>
				Promise.all(
					state.repos.map(r =>
						r.switch(state.reference.ref, { createBranch: state.createBranch, progress: false }),
					),
				),
		);
	}

	override isMatch(key: string) {
		return super.isMatch(key);
	}

	override isFuzzyMatch(name: string) {
		return super.isFuzzyMatch(name);
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
        // TODO:
	}
}
