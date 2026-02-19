import { access, copyFile, mkdir } from "node:fs/promises";
import prompts from "prompts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initCommand } from "./init.js";

// Mock all external dependencies
vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn(),
	copyFile: vi.fn(),
	access: vi.fn(),
}));

vi.mock("prompts");

const mockMkdir = vi.mocked(mkdir);
const mockCopyFile = vi.mocked(copyFile);
const mockAccess = vi.mocked(access);
const mockPrompts = vi.mocked(prompts);

describe("initCommand", () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit called");
		});
	});

	afterEach(() => {
		consoleSpy.mockRestore();
		vi.restoreAllMocks();
	});

	describe("successful initialization", () => {
		it("should initialize with npm registry", async () => {
			// Mock file doesn't exist (access throws)
			mockAccess.mockRejectedValue(new Error("File not found"));
			// Mock prompts response - first call for registry selection
			mockPrompts.mockResolvedValue({ registries: ["npm"] });

			await initCommand();

			expect(consoleSpy).toHaveBeenCalledWith(
				"🚀 Initializing CD tools configuration...",
			);
			expect(mockMkdir).toHaveBeenCalledWith(".cdtools", { recursive: true });
			expect(mockCopyFile).toHaveBeenCalledWith(
				expect.stringContaining("default-files/config.json"),
				".cdtools/config.json",
			);
			expect(mockCopyFile).toHaveBeenCalledWith(
				expect.stringContaining("default-files/release-npm.yml"),
				".github/workflows/release-npm.yml",
			);
			expect(mockCopyFile).toHaveBeenCalledWith(
				expect.stringContaining("default-files/publish-npm.yml"),
				".github/workflows/publish-npm.yml",
			);
			expect(mockCopyFile).toHaveBeenCalledWith(
				expect.stringContaining("default-files/analyze-workspaces.sh"),
				".github/scripts/analyze-workspaces.sh",
			);
			expect(consoleSpy).toHaveBeenCalledWith(
				"🎉 CD tools initialization complete!",
			);
		});

		it("should initialize with multiple registries", async () => {
			mockAccess.mockRejectedValue(new Error("File not found"));
			mockPrompts.mockResolvedValue({ registries: ["npm", "docker"] });

			await initCommand();

			// Verify all expected files are copied
			// Note: copyFileWithConfirmation is now used, so each file may result in
			// access check which can affect mock call counts
			expect(mockCopyFile).toHaveBeenCalled();
			expect(mockCopyFile).toHaveBeenCalledWith(
				expect.stringContaining("default-files/release-docker.yml"),
				".github/workflows/release-docker.yml",
			);
			expect(mockCopyFile).toHaveBeenCalledWith(
				expect.stringContaining("default-files/publish-container-image.yml"),
				".github/workflows/publish-container-image.yml",
			);
		});

		it("should initialize with crates registry", async () => {
			mockAccess.mockRejectedValue(new Error("File not found"));
			mockPrompts.mockResolvedValue({ registries: ["crates"] });

			await initCommand();

			expect(mockCopyFile).toHaveBeenCalledWith(
				expect.stringContaining("default-files/release-crates.yml"),
				".github/workflows/release-crates.yml",
			);
			expect(mockCopyFile).toHaveBeenCalledWith(
				expect.stringContaining("default-files/publish-crates.yml"),
				".github/workflows/publish-crates.yml",
			);
		});
	});

	describe("overwrite handling", () => {
		it("should continue with initialization when config overwrite is declined", async () => {
			mockAccess
				.mockResolvedValueOnce(undefined) // config exists
				.mockRejectedValue(new Error("File not found")); // other files don't exist
			mockPrompts
				.mockResolvedValueOnce({ overwrite: false }) // Decline config overwrite
				.mockResolvedValueOnce({ registries: ["npm"] }); // Select registries

			await initCommand();

			expect(consoleSpy).toHaveBeenCalledWith(
				"⏭️  Skipped .cdtools/config.json",
			);
			// Config file should not be copied
			expect(mockCopyFile).not.toHaveBeenCalledWith(
				expect.stringContaining("default-files/config.json"),
				".cdtools/config.json",
			);
			// But other files should still be copied
			expect(mockCopyFile).toHaveBeenCalledWith(
				expect.stringContaining("default-files/release-npm.yml"),
				".github/workflows/release-npm.yml",
			);
			expect(consoleSpy).toHaveBeenCalledWith(
				"🎉 CD tools initialization complete!",
			);
		});
	});

	describe("error handling", () => {
		it("should handle mkdir failure", async () => {
			mockMkdir.mockRejectedValue(new Error("Permission denied"));

			await expect(initCommand()).rejects.toThrow("process.exit called");

			expect(console.error).toHaveBeenCalledWith(
				"❌ Failed to create .cdtools directory:",
				expect.any(Error),
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it("should handle no registries selected", async () => {
			mockAccess.mockRejectedValue(new Error("File not found"));
			mockPrompts.mockResolvedValue({ registries: [] });

			await initCommand();

			expect(consoleSpy).toHaveBeenCalledWith(
				"❌ No registries selected. Initialization cancelled.",
			);
		});

		it("should handle workflow copy failure gracefully", async () => {
			mockAccess.mockRejectedValue(new Error("File not found"));
			mockPrompts.mockResolvedValue({ registries: ["npm"] });
			mockCopyFile
				.mockResolvedValueOnce() // config copy succeeds
				.mockRejectedValueOnce(new Error("Workflow copy failed")); // release-npm workflow copy fails

			await initCommand();

			expect(console.error).toHaveBeenCalledWith(
				"❌ Failed to copy release-npm.yml:",
				expect.any(Error),
			);
			expect(consoleSpy).toHaveBeenCalledWith(
				"🎉 CD tools initialization complete!",
			);
		});
	});

	describe("registry selection", () => {
		it("should handle unknown registry gracefully", async () => {
			mockAccess.mockRejectedValue(new Error("File not found"));
			// Mock an unknown registry somehow getting through
			mockPrompts.mockResolvedValue({ registries: ["unknown"] });

			await initCommand();

			expect(console.warn).toHaveBeenCalledWith("⚠️  Unknown registry: unknown");
			expect(consoleSpy).toHaveBeenCalledWith(
				"🎉 CD tools initialization complete!",
			);
		});
	});

	describe("file overwrite prompts - edge cases", () => {
		it("should handle mixed existence of files", async () => {
			// Mock different files existing
			mockAccess
				.mockResolvedValueOnce(undefined) // config exists (check)
				.mockRejectedValueOnce(new Error("File not found")) // release-npm.yml doesn't exist
				.mockResolvedValueOnce(undefined) // publish-npm.yml exists
				.mockRejectedValueOnce(new Error("File not found")); // analyze script doesn't exist

			mockPrompts
				.mockResolvedValueOnce({ overwrite: true }) // config.json overwrite
				.mockResolvedValueOnce({ registries: ["npm"] }) // registry selection
				.mockResolvedValueOnce({ overwrite: false }); // publish-npm.yml overwrite

			await initCommand();

			// Should only prompt for existing files
			const confirmCalls = mockPrompts.mock.calls.filter((call) =>
				Array.isArray(call[0]) ? false : call[0].type === "confirm",
			);
			expect(confirmCalls).toHaveLength(2); // config.json and publish-npm.yml

			// Files copied: config.json, release-npm.yml (no prompt), analyze script (no prompt)
			// Not copied: publish-npm.yml (declined)
			expect(mockCopyFile).toHaveBeenCalledTimes(3);
			expect(consoleSpy).toHaveBeenCalledWith("⏭️  Skipped publish-npm.yml");
		});
	});
});
