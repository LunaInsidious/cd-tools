import { exec } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execAsync = promisify(exec);

/**
 * Tests for the analyze-workspaces.sh script
 * This tests the core workspace analysis logic used by GitHub Actions workflows
 */
describe("analyze-workspaces.sh Script Tests", () => {
	const testDir = "/tmp/cd-tools-script-test";
	const cdtoolsDir = join(testDir, ".cdtools");
	const scriptPath = join(process.cwd(), "default-files/analyze-workspaces.sh");
	let originalCwd: string;

	beforeEach(async () => {
		originalCwd = process.cwd();
		// Clean up and create test directory
		try {
			await rm(testDir, { recursive: true, force: true });
		} catch {
			// Directory might not exist
		}
		await mkdir(testDir, { recursive: true });
		await mkdir(cdtoolsDir, { recursive: true });

		// Create mock config.json
		const config = {
			projects: [
				{
					path: "packages/frontend",
					baseVersion: "1.0.0",
					registries: ["npm"],
				},
				{
					path: "packages/backend",
					baseVersion: "2.0.0",
					registries: ["docker"],
				},
				{
					path: "packages/fullstack",
					baseVersion: "1.5.0",
					registries: ["npm", "docker"],
				},
				{
					path: "packages/rustlib",
					baseVersion: "0.1.0",
					registries: ["crates"],
				},
			],
			versioningStrategy: "independent",
			versionTags: {
				alpha: {
					versionSuffixStrategy: "timestamp",
					next: "rc",
				},
			},
		};

		await writeFile(
			join(cdtoolsDir, "config.json"),
			JSON.stringify(config, null, 2),
		);

		// Change to test directory
		process.chdir(testDir);

		// Initialize git repo with timeout
		try {
			await execAsync("git init");
			await execAsync("git config user.email 'test@example.com'");
			await execAsync("git config user.name 'Test User'");
			await execAsync("git add .");
			await execAsync("git commit -m 'Initial commit'");
		} catch (error) {
			console.warn("Git setup failed, continuing without git:", error);
		}
	});

	afterEach(async () => {
		// Always restore the original working directory
		process.chdir(originalCwd);

		// Clean up test directory
		try {
			await rm(testDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	describe("NPM filter", () => {
		it("should analyze NPM-only workspaces", async () => {
			await execAsync("git checkout -b feat/npm\\(alpha\\)");

			const branchInfo = {
				tag: "alpha",
				parentBranch: "main",
				projectUpdated: {
					"packages/frontend": "1.0.1-alpha.20231225103045",
					"packages/fullstack": "1.5.1-alpha.20231225103045",
				},
			};

			await writeFile(
				join(cdtoolsDir, "alpha-feat-npm.json"),
				JSON.stringify(branchInfo, null, 2),
			);

			const { stdout } = await execAsync(`${scriptPath} npm`);

			expect(stdout).toContain("has-npm=true");
			expect(stdout).toContain("release-tag=alpha");
			expect(stdout).toMatch(/npm-matrix=.*workspace_path.*packages\/frontend/);
			expect(stdout).toMatch(
				/npm-matrix=.*workspace_path.*packages\/fullstack/,
			);
		});

		it("should handle no NPM workspaces", async () => {
			await execAsync("git checkout -b feat/docker-only\\(alpha\\)");

			const branchInfo = {
				tag: "alpha",
				parentBranch: "main",
				projectUpdated: {
					"packages/backend": "2.0.1-alpha.20231225103045",
				},
			};

			await writeFile(
				join(cdtoolsDir, "alpha-feat-docker-only.json"),
				JSON.stringify(branchInfo, null, 2),
			);

			const { stdout } = await execAsync(`${scriptPath} npm`);

			expect(stdout).toContain("has-npm=false");
			expect(stdout).toContain("release-tag=alpha");
			expect(stdout).toContain('npm-matrix={"include":[]}');
		});
	});

	describe("Docker filter", () => {
		it("should analyze Docker-only workspaces", async () => {
			await execAsync("git checkout -b feat/docker\\(alpha\\)");

			const branchInfo = {
				tag: "alpha",
				parentBranch: "main",
				projectUpdated: {
					"packages/backend": "2.0.1-alpha.20231225103045",
					"packages/fullstack": "1.5.1-alpha.20231225103045",
				},
			};

			await writeFile(
				join(cdtoolsDir, "alpha-feat-docker.json"),
				JSON.stringify(branchInfo, null, 2),
			);

			const { stdout } = await execAsync(`${scriptPath} docker`);

			expect(stdout).toContain("has-docker=true");
			expect(stdout).toContain("release-tag=alpha");
			expect(stdout).toMatch(
				/docker-matrix=.*workspace_path.*packages\/backend/,
			);
			expect(stdout).toMatch(
				/docker-matrix=.*workspace_path.*packages\/fullstack/,
			);
		});

		it("should handle no Docker workspaces", async () => {
			await execAsync("git checkout -b feat/npm-only\\(alpha\\)");

			const branchInfo = {
				tag: "alpha",
				parentBranch: "main",
				projectUpdated: {
					"packages/frontend": "1.0.1-alpha.20231225103045",
				},
			};

			await writeFile(
				join(cdtoolsDir, "alpha-feat-npm-only.json"),
				JSON.stringify(branchInfo, null, 2),
			);

			const { stdout } = await execAsync(`${scriptPath} docker`);

			expect(stdout).toContain("has-docker=false");
			expect(stdout).toContain("release-tag=alpha");
			expect(stdout).toContain('docker-matrix={"include":[]}');
		});
	});

	describe("Crates filter", () => {
		it("should analyze crates-only workspaces", async () => {
			await execAsync("git checkout -b feat/crates\\(alpha\\)");

			const branchInfo = {
				tag: "alpha",
				parentBranch: "main",
				projectUpdated: {
					"packages/rustlib": "0.1.1-alpha.20231225103045",
				},
			};

			await writeFile(
				join(cdtoolsDir, "alpha-feat-crates.json"),
				JSON.stringify(branchInfo, null, 2),
			);

			const { stdout } = await execAsync(`${scriptPath} crates`);

			expect(stdout).toContain("has-crates=true");
			expect(stdout).toContain("release-tag=alpha");
			expect(stdout).toMatch(
				/crates-matrix=.*workspace_path.*packages\/rustlib/,
			);
		});

		it("should handle no crates workspaces", async () => {
			await execAsync("git checkout -b feat/no-crates\\(alpha\\)");

			const branchInfo = {
				tag: "alpha",
				parentBranch: "main",
				projectUpdated: {
					"packages/frontend": "1.0.1-alpha.20231225103045",
				},
			};

			await writeFile(
				join(cdtoolsDir, "alpha-feat-no-crates.json"),
				JSON.stringify(branchInfo, null, 2),
			);

			const { stdout } = await execAsync(`${scriptPath} crates`);

			expect(stdout).toContain("has-crates=false");
			expect(stdout).toContain("release-tag=alpha");
			expect(stdout).toContain('crates-matrix={"include":[]}');
		});
	});

	describe("All filter", () => {
		it("should analyze NPM, Docker, and crates workspaces", async () => {
			await execAsync("git checkout -b feat/all\\(alpha\\)");

			const branchInfo = {
				tag: "alpha",
				parentBranch: "main",
				projectUpdated: {
					"packages/frontend": "1.0.1-alpha.20231225103045",
					"packages/backend": "2.0.1-alpha.20231225103045",
					"packages/fullstack": "1.5.1-alpha.20231225103045",
					"packages/rustlib": "0.1.1-alpha.20231225103045",
				},
			};

			await writeFile(
				join(cdtoolsDir, "alpha-feat-all.json"),
				JSON.stringify(branchInfo, null, 2),
			);

			const { stdout } = await execAsync(`${scriptPath} all`);

			expect(stdout).toContain("has-npm=true");
			expect(stdout).toContain("has-docker=true");
			expect(stdout).toContain("has-crates=true");
			expect(stdout).toContain("release-tag=alpha");
			expect(stdout).toMatch(/npm-matrix=.*packages\/frontend/);
			expect(stdout).toMatch(/npm-matrix=.*packages\/fullstack/);
			expect(stdout).toMatch(/docker-matrix=.*packages\/backend/);
			expect(stdout).toMatch(/docker-matrix=.*packages\/fullstack/);
			expect(stdout).toMatch(/crates-matrix=.*packages\/rustlib/);
		});
	});

	describe("Error handling", () => {
		it("should fail with invalid registry filter", async () => {
			try {
				await execAsync(`${scriptPath} invalid`);
				expect.fail("Should have thrown an error");
			} catch (error) {
				expect(error instanceof Error ? error.message : "").toContain(
					"Invalid registry filter: invalid",
				);
			}
		});

		it("should fail when config.json is missing", async () => {
			await rm(join(cdtoolsDir, "config.json"));

			// Create a branch info file to get past the branch info check
			const branchInfo = {
				tag: "alpha",
				parentBranch: "main",
				projectUpdated: {
					"packages/frontend": "1.0.1-alpha.20231225103045",
				},
			};
			await writeFile(
				join(cdtoolsDir, "alpha-feat-test.json"),
				JSON.stringify(branchInfo, null, 2),
			);

			try {
				await execAsync(`${scriptPath} npm`);
				expect.fail("Should have thrown an error");
			} catch (error) {
				expect(error instanceof Error ? error.message : "").toContain(
					"Config file not found",
				);
			}
		});

		it("should return empty results when branch info file is missing", async () => {
			await execAsync("git checkout -b feat/missing\\(alpha\\)");

			const { stdout } = await execAsync(`${scriptPath} npm`);

			expect(stdout).toContain("has-npm=false");
			expect(stdout).toContain("release-tag=stable");
			expect(stdout).toContain('npm-matrix={"include":[]}');
		});

		it("should handle empty projectUpdated", async () => {
			// Create a valid git branch first
			await execAsync("git checkout -b feat/empty\\(alpha\\)");

			const branchInfo = {
				tag: "alpha",
				parentBranch: "main",
				projectUpdated: {}, // Empty but present
			};

			// Use exact filename pattern that matches current branch or fallback
			await writeFile(
				join(cdtoolsDir, "alpha-feat-empty-alpha-.json"),
				JSON.stringify(branchInfo, null, 2),
			);

			const { stdout } = await execAsync(`${scriptPath} all`);

			expect(stdout).toContain("has-npm=false");
			expect(stdout).toContain("has-docker=false");
			expect(stdout).toContain("has-crates=false");
			expect(stdout).toContain("release-tag=alpha");
			expect(stdout).toContain('npm-matrix={"include":[]}');
			expect(stdout).toContain('docker-matrix={"include":[]}');
			expect(stdout).toContain('crates-matrix={"include":[]}');
		});
	});

	describe("Branch info file detection", () => {
		it("should detect file based on current branch name", async () => {
			await execAsync("git checkout -b feat/branch-detection\\(alpha\\)");

			const branchInfo = {
				tag: "alpha",
				parentBranch: "main",
				projectUpdated: {
					"packages/frontend": "1.0.1-alpha.20231225103045",
				},
			};

			// Create file with expected name pattern
			await writeFile(
				join(cdtoolsDir, "alpha-feat-branch-detection.json"),
				JSON.stringify(branchInfo, null, 2),
			);

			const { stdout } = await execAsync(`${scriptPath} npm`);

			expect(stdout).toContain("has-npm=true");
			expect(stdout).toContain("release-tag=alpha");
		});

		it("should fallback to projectUpdated search", async () => {
			await execAsync("git checkout -b feat/unknown-pattern\\(alpha\\)");

			const branchInfo = {
				tag: "alpha",
				parentBranch: "main",
				projectUpdated: {
					"packages/frontend": "1.0.1-alpha.20231225103045",
				},
			};

			// Create file with different name pattern
			await writeFile(
				join(cdtoolsDir, "alpha-some-other-name.json"),
				JSON.stringify(branchInfo, null, 2),
			);

			const { stdout } = await execAsync(`${scriptPath} npm`);

			expect(stdout).toContain("has-npm=true");
			expect(stdout).toContain("release-tag=alpha");
		});
	});

	describe("Matrix format validation", () => {
		it("should generate valid JSON matrix format", async () => {
			await execAsync("git checkout -b feat/matrix\\(alpha\\)");

			const branchInfo = {
				tag: "alpha",
				parentBranch: "main",
				projectUpdated: {
					"packages/frontend": "1.0.1-alpha.20231225103045",
				},
			};

			await writeFile(
				join(cdtoolsDir, "alpha-feat-matrix.json"),
				JSON.stringify(branchInfo, null, 2),
			);

			const { stdout } = await execAsync(`${scriptPath} npm`);

			// Verify tag output
			expect(stdout).toContain("release-tag=alpha");

			// Extract and validate JSON
			const npmMatrixMatch = stdout.match(/npm-matrix=(.+)/);
			expect(npmMatrixMatch).toBeTruthy();

			const matrix = JSON.parse(npmMatrixMatch![1]);
			expect(matrix).toHaveProperty("include");
			expect(Array.isArray(matrix.include)).toBe(true);
			expect(matrix.include).toHaveLength(1);
			expect(matrix.include[0]).toHaveProperty(
				"workspace_path",
				"packages/frontend",
			);
			expect(matrix.include[0]).toHaveProperty(
				"workspace_version",
				"1.0.1-alpha.20231225103045",
			);
		});
	});
});
