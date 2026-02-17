import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPrCommand } from "./start-pr.js";

// Mock all external dependencies
vi.mock("../utils/config.js", () => ({
	checkInitialized: vi.fn(),
	loadConfig: vi.fn(),
	getAvailableVersionTags: vi.fn(),
	createBranchInfo: vi.fn(),
}));

vi.mock("../utils/git.js", () => ({
	getCurrentBranch: vi.fn(),
	pullLatest: vi.fn(),
	createAndCheckoutBranch: vi.fn(),
	validateBranchName: vi.fn(),
}));

vi.mock("prompts", () => ({
	default: vi.fn(),
}));

import prompts from "prompts";
// Import mocked modules
import {
	type Config,
	checkInitialized,
	createBranchInfo,
	getAvailableVersionTags,
	loadConfig,
} from "../utils/config.js";
import {
	createAndCheckoutBranch,
	getCurrentBranch,
	pullLatest,
	validateBranchName,
} from "../utils/git.js";

const mockCheckInitialized = vi.mocked(checkInitialized);
const mockLoadConfig = vi.mocked(loadConfig);
const mockGetAvailableVersionTags = vi.mocked(getAvailableVersionTags);
const mockCreateBranchInfo = vi.mocked(createBranchInfo);
const mockGetCurrentBranch = vi.mocked(getCurrentBranch);
const mockPullLatest = vi.mocked(pullLatest);
const mockCreateAndCheckoutBranch = vi.mocked(createAndCheckoutBranch);
const mockValidateBranchName = vi.mocked(validateBranchName);
const mockPrompts = vi.mocked(prompts);

describe("startPrCommand", () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;

	const mockConfig: Config = {
		versioningStrategy: "fixed",
		versionTags: [
			{ alpha: { versionSuffixStrategy: "timestamp" } },
			{ rc: { versionSuffixStrategy: "increment", next: "stable" } },
		],
		projects: [],
	};

	beforeEach(() => {
		vi.clearAllMocks();
		consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit called");
		});

		// Default successful mocks
		mockCheckInitialized.mockResolvedValue(true);
		mockGetCurrentBranch.mockResolvedValue("main");
		mockPullLatest.mockResolvedValue();
		mockLoadConfig.mockResolvedValue(mockConfig);
		mockGetAvailableVersionTags.mockReturnValue([
			{ title: "alpha", value: "alpha" },
			{ title: "rc", value: "rc" },
		]);
		mockValidateBranchName.mockResolvedValue();
		mockCreateAndCheckoutBranch.mockResolvedValue();
		mockCreateBranchInfo.mockResolvedValue();
	});

	afterEach(() => {
		consoleSpy.mockRestore();
		vi.restoreAllMocks();
	});

	describe("successful flow", () => {
		it("should complete start-pr successfully", async () => {
			mockPrompts
				.mockResolvedValueOnce({ releaseMode: "rc" })
				.mockResolvedValueOnce({ branchName: "feat/new-feature" });

			await startPrCommand();

			// Should check initialization
			expect(mockCheckInitialized).toHaveBeenCalledOnce();

			// Should get current branch and pull latest
			expect(mockGetCurrentBranch).toHaveBeenCalledOnce();
			expect(mockPullLatest).toHaveBeenCalledWith("main");

			// Should load config and get available tags
			expect(mockLoadConfig).toHaveBeenCalledOnce();
			expect(mockGetAvailableVersionTags).toHaveBeenCalledWith(mockConfig);

			// Should prompt for release mode and branch name
			expect(mockPrompts).toHaveBeenCalledWith({
				type: "select",
				name: "releaseMode",
				message: "Select release mode:",
				choices: [
					{ title: "alpha", value: "alpha" },
					{ title: "rc", value: "rc" },
				],
			});

			// Should create and checkout branch
			expect(mockCreateAndCheckoutBranch).toHaveBeenCalledWith(
				"feat/new-feature(rc)",
			);

			// Should create branch info file
			expect(mockCreateBranchInfo).toHaveBeenCalledWith(
				"rc",
				"feat/new-feature",
				"main",
			);

			expect(consoleSpy).toHaveBeenCalledWith(
				"✅ Release PR started successfully!",
			);
		});

		it("should handle different release modes", async () => {
			mockPrompts
				.mockResolvedValueOnce({ releaseMode: "alpha" })
				.mockResolvedValueOnce({ branchName: "hotfix/critical-bug" });

			await startPrCommand();

			expect(mockCreateAndCheckoutBranch).toHaveBeenCalledWith(
				"hotfix/critical-bug(alpha)",
			);
			expect(mockCreateBranchInfo).toHaveBeenCalledWith(
				"alpha",
				"hotfix/critical-bug",
				"main",
			);
		});

		it("should handle stable release mode", async () => {
			// Update mock to return stable tag as well
			mockGetAvailableVersionTags.mockReturnValue([
				{ title: "alpha", value: "alpha" },
				{ title: "rc", value: "rc" },
				{ title: "stable", value: "stable" },
			]);

			mockPrompts
				.mockResolvedValueOnce({ releaseMode: "stable" })
				.mockResolvedValueOnce({ branchName: "release/v2.0.0" });

			await startPrCommand();

			expect(mockCreateAndCheckoutBranch).toHaveBeenCalledWith(
				"release/v2.0.0(stable)",
			);
			expect(mockCreateBranchInfo).toHaveBeenCalledWith(
				"stable",
				"release/v2.0.0",
				"main",
			);
		});

		it("should validate branch name during input", async () => {
			mockPrompts
				.mockResolvedValueOnce({ releaseMode: "rc" })
				.mockResolvedValueOnce({ branchName: "feat/special-chars" });

			await startPrCommand();

			// Verify the validate function was called during prompt
			const promptCalls = mockPrompts.mock.calls;
			const branchNamePromptCall = promptCalls.find((call) =>
				Array.isArray(call[0]) ? false : call[0].name === "branchName",
			);
			expect(branchNamePromptCall).toBeDefined();
			if (branchNamePromptCall && !Array.isArray(branchNamePromptCall[0])) {
				expect(branchNamePromptCall[0]).toHaveProperty("validate");
			}
		});
	});

	describe("error handling", () => {
		it("should exit if not initialized", async () => {
			mockCheckInitialized.mockResolvedValue(false);

			await expect(startPrCommand()).rejects.toThrow("process.exit called");

			expect(console.error).toHaveBeenCalledWith(
				"❌ cd-tools has not been initialized. Run 'cd-tools init' first.",
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it("should exit if pull fails", async () => {
			mockPullLatest.mockRejectedValue(new Error("Network error"));

			await expect(startPrCommand()).rejects.toThrow("process.exit called");

			expect(console.error).toHaveBeenCalledWith(
				"❌ Failed to pull latest changes: Network error",
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it("should exit if config load fails", async () => {
			mockLoadConfig.mockRejectedValue(new Error("Config not found"));

			await expect(startPrCommand()).rejects.toThrow("process.exit called");

			expect(console.error).toHaveBeenCalledWith(
				"❌ Failed to load configuration: Config not found",
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it("should exit if no version tags available", async () => {
			mockGetAvailableVersionTags.mockReturnValue([]);

			await expect(startPrCommand()).rejects.toThrow("process.exit called");

			expect(console.error).toHaveBeenCalledWith(
				"❌ No version tags found in configuration.",
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it("should cancel if no release mode selected", async () => {
			mockPrompts.mockResolvedValue({ releaseMode: undefined });

			await startPrCommand();

			expect(consoleSpy).toHaveBeenCalledWith(
				"❌ No release mode selected. Operation cancelled.",
			);
			expect(mockCreateAndCheckoutBranch).not.toHaveBeenCalled();
		});

		it("should cancel if no branch name entered", async () => {
			mockPrompts
				.mockResolvedValueOnce({ releaseMode: "rc" })
				.mockResolvedValueOnce({ branchName: "" });

			await startPrCommand();

			expect(consoleSpy).toHaveBeenCalledWith(
				"❌ No branch name entered. Operation cancelled.",
			);
			expect(mockCreateAndCheckoutBranch).not.toHaveBeenCalled();
		});

		it("should exit if branch creation fails", async () => {
			mockPrompts
				.mockResolvedValueOnce({ releaseMode: "rc" })
				.mockResolvedValueOnce({ branchName: "feat/test" });
			mockCreateAndCheckoutBranch.mockRejectedValue(
				new Error("Branch already exists"),
			);

			await expect(startPrCommand()).rejects.toThrow("process.exit called");

			expect(console.error).toHaveBeenCalledWith(
				"❌ Failed to create branch: Branch already exists",
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it("should exit if branch info creation fails", async () => {
			mockPrompts
				.mockResolvedValueOnce({ releaseMode: "rc" })
				.mockResolvedValueOnce({ branchName: "feat/test" });
			mockCreateBranchInfo.mockRejectedValue(new Error("File write error"));

			await expect(startPrCommand()).rejects.toThrow("process.exit called");

			expect(console.error).toHaveBeenCalledWith(
				"❌ Failed to create branch tracking file: File write error",
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});
	});

	describe("branch validation", () => {
		it("should create branch with correct full name including release mode", async () => {
			mockPrompts
				.mockResolvedValueOnce({ releaseMode: "rc" })
				.mockResolvedValueOnce({ branchName: "feat/test" });

			await startPrCommand();

			expect(mockCreateAndCheckoutBranch).toHaveBeenCalledWith("feat/test(rc)");
		});
	});

	describe("logging and user feedback", () => {
		it("should display current branch information", async () => {
			mockGetCurrentBranch.mockResolvedValue("develop");
			mockPrompts
				.mockResolvedValueOnce({ releaseMode: "rc" })
				.mockResolvedValueOnce({ branchName: "feat/test" });

			await startPrCommand();

			expect(consoleSpy).toHaveBeenCalledWith("📂 Current branch: develop");
			expect(mockPullLatest).toHaveBeenCalledWith("develop");
		});

		it("should display next steps after successful completion", async () => {
			mockPrompts
				.mockResolvedValueOnce({ releaseMode: "rc" })
				.mockResolvedValueOnce({ branchName: "feat/test" });

			await startPrCommand();

			expect(consoleSpy).toHaveBeenCalledWith("Next steps:");
			expect(consoleSpy).toHaveBeenCalledWith(
				"1. Make your changes and commit them to the new branch.",
			);
			expect(consoleSpy).toHaveBeenCalledWith(
				"2. Run 'cd-tools push-pr' to update versions and create PR",
			);
		});
	});
});
