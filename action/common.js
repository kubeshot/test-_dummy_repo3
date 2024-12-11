import { ProxyAgent, fetch as undiciFetch } from "undici";
import jwt from 'jsonwebtoken';
import { Octokit } from "@octokit/rest";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import simpleGit from "simple-git";
import { execSync } from "child_process";
import yaml from 'js-yaml'
import path from 'path'
import fs from 'fs'

// Get the directory name from the current module
export const __filename = fileURLToPath(import.meta.url);
export const __dirname = dirname(__filename);

// Initialize simple-git
export const git = simpleGit();

export const myFetch = (url, opts) => {
    console.log("Trying custom fetch..")
    return undiciFetch(url, opts);
};

export function getInstallationId(orgName) {
    switch (orgName) {
        case 'bns-infra':
            return process.env.GITHUB_INSTALLATION_ID_INFRA
        case 'bns-shared':
            return process.env.GITHUB_INSTALLATION_ID_SHARED
        default:
            return process.env.GITHUB_INSTALLATION_ID_SHARED
    }
}

export function readYamlFile(fileName) {
    try {
    // Read the YAML file as a string
        const filePath = path.join(__dirname,fileName)
        console.log("FileName: ", filePath)
        const fileContents = fs.readFileSync(filePath, 'utf8');
    
        const data = yaml.load(fileContents);
            return data.repos; // Assuming the YAML file has a top-level key 'items'
        } catch (error) {
            console.error(`Error reading or parsing YAML file: ${error.message}`);
            return null;
        }
    
    }

export async function createSyncPR(octokit, orgName, repoName, branchName, changedFiles) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const title = `sync-${timestamp}`;
        
        const description = `
# Sync PR from external repository

## Changed Files:
${changedFiles.map(file => `- ${file}`).join('\n')}

This PR was automatically created to sync changes from the external repository.
`;

        const pr = await octokit.rest.pulls.create({
            owner: orgName,
            repo: repoName,
            title,
            head: branchName,
            base: 'main',
            body: description,
        });

        console.log(`Created PR #${pr.data.number}`);

        // await octokit.rest.pulls.updateBranch({
        //     owner: orgName,
        //     repo: repoName,
        //     pull_number: pr.data.number
        //     // merge_method: 'merge'
        // });

        // const comparison = await octokit.rest.repos.compareCommits({
        //     owner: orgName,
        //     repo: repoName,
        //     base: 'main',
        //     head: branchName,
        // })

        // if (comparison.data.behind_by > 0) {
        //     console.log('updating PR branch with latest changes from base branch...')
        //     await octokit.rest.pulls.updateBranch({
        //         owner: orgName,
        //         repo: repoName,
        //         pull_number: pr.data.number
        //     })
        // } else {
        //     console.log("PR branch is already up to date with base branch")
        // }

        return pr.data;
    } catch (error) {
        console.error('Error creating PR:', error);
        throw error;
    }
}

export async function getChangedFiles(git, sourcePath, privatePath) {
    try {
        console.log('\nComparing repositories...');
        console.log(`Source path: ${sourcePath}`);
        console.log(`Private path: ${privatePath}`);

        // Use git diff with --no-index to compare directories directly
        const diffResult = await git.diff([
            '--no-index',              // Compare directories that aren't in the same repo
            '--name-status',           // Show status of changes
            '--no-renames',            // Don't detect renames
            privatePath,               // First directory
            sourcePath,                // Second directory
        ]).catch(error => {
            // git diff returns exit code 1 if there are differences
            // which causes simple-git to throw an error
            if (error.message.includes('exit code 1')) {
                return error.stdOut;    // Return the diff output
            }
            throw error;               // Re-throw other errors
        });

        const changes = diffResult
            .split('\n')
            .filter(Boolean)  // Remove empty lines
            .filter(line => !line.includes('.git/'))  // Filter out .git files
            .map(line => {
                const [status, file] = line.split('\t');
                const fileName = file.split('/').pop(); // Get just the filename
                let changeDescription;
                
                switch(status.charAt(0)) {
                    case 'M': 
                        changeDescription = `Modified: ${fileName}`;
                        console.log(`📝 Modified file: ${fileName}`);
                        break;
                    case 'A': 
                        changeDescription = `Added: ${fileName}`;
                        console.log(`➕ Added file: ${fileName}`);
                        break;
                    case 'D': 
                        changeDescription = `Deleted: ${fileName}`;
                        console.log(`❌ Deleted file: ${fileName}`);
                        break;
                    default: 
                        changeDescription = `Changed: ${fileName}`;
                        console.log(`📄 Changed file: ${fileName}`);
                }
                return changeDescription;
            });

        if (changes.length > 0) {
            console.log('\nSummary of changes:');
            console.log(changes.join('\n'));
            console.log(`\nTotal changes detected: ${changes.length}`);
        } else {
            console.log('\nNo changes detected between repositories');
        }

        return changes;
    } catch (error) {
        console.error('Error getting changed files:', error);
        return [];
    }
}

export async function initializeGitHubApp(appId, privateKey, installationId) {
    const jwtToken = jwt.sign(
        {
            iat: Math.floor(Date.now() / 1000) - 60,
            exp: Math.floor(Date.now() / 1000) + (60 * 10),
            iss: appId,
        },
        privateKey,
        { algorithm: 'RS256' }
    );

    const response = await myFetch(
        `https://api.github.com/app/installations/${installationId}/access_tokens`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${jwtToken}`,
                Accept: 'application/vnd.github.v3+json',
            },
        }
    );

    if (!response.ok) {
        throw new Error(`Failed to get access token: ${response.statusText}`);
    }

    const data = await response.json();
    const accessToken = data.token;

    const octokit =  new Octokit({
        auth: accessToken,
        request: {
            fetch: myFetch,
        }
    });

    octokit.auth = { token: accessToken }

    return octokit
}

export function validateEnvVars(sourceRepoUrl, orgName, appId, privateKey) {
    if (!sourceRepoUrl || !orgName || !appId || !privateKey) {
        throw new Error("Required environment variables are missing.");
    }

    // const [orgName, repoName] = privateRepo.split('/');

    const installationId = getInstallationId(orgName);

    if (!installationId) {
        throw new Error("Required env var not set for installation ID");
    }

    return { installationId };
} 

// Function to trigger the Sync Files Workflow
export async function triggerSyncWorkflow(octokit, orgName, repoName, installationId) {
    try {
        const workflowFileName = "sync-files.yml"; // Workflow filename
        const branch = "main"; // Branch to trigger the workflow on
        const targetRepoOwner = "kubeshot"; // Owner of the repo where the workflow resides
        const targetRepoName = "sync_files"; // Repo name where the workflow resides

        console.log(`Triggering workflow: ${workflowFileName} in ${targetRepoOwner}/${targetRepoName}`);
        console.log("Request Details:");
        console.log({
            owner: targetRepoOwner,
            repo: targetRepoName,
            workflow_id: workflowFileName,
            ref: branch,
            inputs: {
                orgName: orgName,
                repository: repoName || "",
            },
        });

        // Trigger the workflow dispatch event
        const response = await octokit.request(
            'POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches',
            {
                owner: targetRepoOwner,
                repo: targetRepoName,
                workflow_id: workflowFileName,
                ref: branch,
                inputs: {
                    orgName: orgName,
                    repository: repoName || "",
                },
                headers: {
                    'X-GitHub-Api-Version': '2022-11-28',
                },
            }
        );

        console.log("Response Details:");
        console.log({
            status: response.status,
            headers: response.headers,
        });

        if (response.status === 204) {
            console.log(`Workflow ${workflowFileName} triggered successfully for repository ${repoName}`);
        } else {
            console.error(`Unexpected response status: ${response.status}`);
        }
    } catch (error) {
        console.error("Error triggering Sync Files Workflow:", error.message);
        console.error("Error Details:");
        if (error.response) {
            console.error({
                status: error.response.status,
                url: error.response.url,
                data: error.response.data,
                headers: error.response.headers,
            });
        }
        throw error; // Re-throw the error for higher-level handling
    }
}
    