import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import prompts from "prompts";

/**
 * Copy a file with overwrite confirmation
 * @param source Source file path
 * @param target Target file path
 * @param displayName Display name for user messages
 * @returns true if file was copied, false if skipped
 */
async function copyFileWithConfirmation(
	source: string,
	target: string,
	displayName: string,
): Promise<boolean> {
	try {
		// Check if target file already exists
		try {
			await access(target);
			const { overwrite } = await prompts({
				type: "confirm",
				name: "overwrite",
				message: `${displayName} already exists. Overwrite?`,
				initial: false,
			});

			if (!overwrite) {
				console.log(`⏭️  Skipped ${displayName}`);
				return false;
			}
		} catch {
			// File doesn't exist, continue
		}

		await copyFile(source, target);
		console.log(`✅ Copied ${displayName}`);
		return true;
	} catch (error) {
		console.error(`❌ Failed to copy ${displayName}:`, error);
		throw error;
	}
}

/**
 * Initialize cd-tools configuration and workflow files
 *
 * This command:
 * 1. Copies default config.json to .cdtools directory
 * 2. Prompts user to select target registries
 * 3. Copies appropriate workflow files based on selection
 */
export async function initCommand(): Promise<void> {
	console.log("🚀 Initializing CD tools configuration...");

	// Ensure .cdtools directory exists
	try {
		await mkdir(".cdtools", { recursive: true });
	} catch (error) {
		console.error("❌ Failed to create .cdtools directory:", error);
		process.exit(1);
	}

	// Copy default config.json
	const defaultConfigPath = join(
		dirname(dirname(import.meta.dirname)),
		"default-files",
		"config.json",
	);
	const targetConfigPath = ".cdtools/config.json";

	try {
		await copyFileWithConfirmation(
			defaultConfigPath,
			targetConfigPath,
			".cdtools/config.json",
		);
		// Continue with the rest of initialization even if config was skipped
	} catch (error) {
		console.error("❌ Failed to copy config.json:", error);
		process.exit(1);
	}

	// Prompt for registry selection
	console.log("Please select the registry you plan to release.");

	const { registries } = await prompts({
		type: "multiselect",
		name: "registries",
		message: "Select target registries:",
		choices: [
			{ title: "npm", value: "npm" },
			{ title: "docker(ghcr.io)", value: "docker" },
			{ title: "rust(crates.io)", value: "crates" },
		],
		min: 1,
	});

	if (!registries || registries.length === 0) {
		console.log("❌ No registries selected. Initialization cancelled.");
		return;
	}

	// Ensure .github/workflows and .github/scripts directories exist
	try {
		await mkdir(".github/workflows", { recursive: true });
		await mkdir(".github/scripts", { recursive: true });
	} catch (error) {
		console.error("❌ Failed to create .github directories:", error);
		process.exit(1);
	}

	// Copy workflow files based on selection
	const defaultFilesDir = join(
		dirname(dirname(import.meta.dirname)),
		"default-files",
	);

	// Copy registry-specific workflows
	for (const registry of registries) {
		try {
			const workflows: { source: string; target: string }[] = [];

			switch (registry) {
				case "npm":
					workflows.push({
						source: join(defaultFilesDir, "release-npm.yml"),
						target: ".github/workflows/release-npm.yml",
					});
					workflows.push({
						source: join(defaultFilesDir, "publish-npm.yml"),
						target: ".github/workflows/publish-npm.yml",
					});
					break;
				case "docker":
					workflows.push({
						source: join(defaultFilesDir, "release-docker.yml"),
						target: ".github/workflows/release-docker.yml",
					});
					workflows.push({
						source: join(defaultFilesDir, "publish-container-image.yml"),
						target: ".github/workflows/publish-container-image.yml",
					});
					break;
				case "crates":
					workflows.push({
						source: join(defaultFilesDir, "release-crates.yml"),
						target: ".github/workflows/release-crates.yml",
					});
					workflows.push({
						source: join(defaultFilesDir, "publish-crates.yml"),
						target: ".github/workflows/publish-crates.yml",
					});
					break;
				default:
					console.warn(`⚠️  Unknown registry: ${registry}`);
					continue;
			}

			// Copy all workflows for this registry
			for (const workflow of workflows) {
				const fileName = workflow.target.split("/").pop() || "workflow";
				await copyFileWithConfirmation(
					workflow.source,
					workflow.target,
					fileName,
				);
			}
		} catch (error) {
			console.error(`❌ Failed to copy workflow for ${registry}:`, error);
		}
	}

	// Copy analyze-workspaces.sh script
	try {
		const analyzeScriptSource = join(defaultFilesDir, "analyze-workspaces.sh");
		const analyzeScriptTarget = ".github/scripts/analyze-workspaces.sh";
		await copyFileWithConfirmation(
			analyzeScriptSource,
			analyzeScriptTarget,
			"analyze-workspaces.sh",
		);
	} catch (error) {
		console.error("❌ Failed to copy analyze-workspaces.sh:", error);
		// Don't exit on analyze script failure, continue with the rest
	}

	console.log("🎉 CD tools initialization complete!");
}
