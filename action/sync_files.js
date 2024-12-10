import fs from "fs";
import path from "path";
import {
    __dirname,
    git,
    initializeGitHubApp,
    validateEnvVars,
    readYamlFile,
    triggerSyncWorkflow
} from './common.js';
import yaml from 'js-yaml'


function readRepoConfig(repos) {
    try {
        // const configPath = path.join(__dirname, 'repos.yml');
        // const fileContents = fs.readFileSync(configPath, 'utf8');
        // const config = yaml.load(fileContents);
        console.log("Repos: ",repos)
        let config = {}
        config.repos = repos

        if (!config.repos.org || !config.repos.external_url) {
            throw new Error('Invalid config file structure. Required: repos.org, repos.repo, repos.external');
        }
        console.log(config.repos.external_url, config.repos.repo)

        return {
            sourceRepoUrl: config.repos.external_url,
            privateRepo: `${config.repos.org}/${config.repos.repo}`
        };
    } catch (error) {
        console.error('Error reading config file:', error);
        throw error;
    }
}

function parseRepoUrl(url) {
    try {
        const repoUrl = new URL(url);
        const hostname = repoUrl.hostname;
        const fullPath = repoUrl.pathname.replace(/^\/|\/$/g, '').replace(/\.git$/, '');

        let platform;
        switch (hostname) {
            case 'github.com':
                platform = 'github';
                break;
            case 'gitlab.com':
                platform = 'gitlab';
                break;
            case 'bitbucket.org':
                platform = 'bitbucket';
                break;
            default:
                throw new Error(`Unsupported platform: ${hostname}`);
        }

        return {
            platform,
            repoPath: fullPath,
            fullUrl: `${repoUrl.origin}/${fullPath}.git`
        };
    } catch (error) {
        throw new Error(`Invalid repository URL: ${error.message}`);
    }
}

async function checkOrgRepo(octokit, orgName, repoName, sourceRepoInfo) {
    try {
        await octokit.rest.repos.get({
            owner: orgName,
            repo: repoName,
        });
        console.log(`Repository ${repoName} already exists in organization ${orgName}.`);
        console.log('Will continue with the Sync File workflow.');
        return true

    } catch (error) {
        if (error.status === 404) {
            console.log(`Repository ${repoName} does not exist in organization ${orgName}. Exiting.`);
        } else {
            console.error('Error checking repository existence:', error);
            throw error;
        }
    }
}

(async () => {
    const repos = readYamlFile('repos.yml') // create
    for (let repo in repos) {
        try {
            const repoConfig = readRepoConfig(repos[repo])
            // const [sourceRepoUrl, privateRepo] = readRepoConfig(repos[repo]);
            const sourceRepoUrl = repoConfig.sourceRepoUrl
            let privateRepo = repoConfig.privateRepo
            const appId = process.env.GITHUB_APP_ID;
            const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
            let sourceRepoInfo;
            try {
                sourceRepoInfo = parseRepoUrl(sourceRepoUrl);
                console.log(`Detected platform: ${sourceRepoInfo.platform}`);
                console.log(`Repository path: ${sourceRepoInfo.repoPath}`);
            } catch (error) {
                console.error(error.message);
                process.exit(1);
            }
            const [sourceOrgName, sourceRepoName] = sourceRepoInfo.repoPath.split('/')

            let [orgName, repoName] = privateRepo.split('/')
            console.log('Repo: ', typeof repoName)
            if (repoName.includes("undefined")) {
                console.log("inside if")
                repoName = `external-${sourceRepoInfo.platform}-${sourceOrgName}-${sourceRepoName}`
                privateRepo = `${orgName}/${repoName}`
                console.log("RepoName: ", repoName)
            }

            const { installationId } = validateEnvVars(
                sourceRepoUrl,
                orgName,
                appId,
                privateKey
            );

            // create octokit client
            const octokit = await initializeGitHubApp(appId, privateKey, installationId);
            //const isRepoExist = await checkOrgRepo(octokit, orgName, repoName, sourceRepoInfo);
            try {
               
                console.log(`Triggering Sync Files Workflow for ${repoName}...`);
                await triggerSyncWorkflow(octokit, orgName, repoName, installationId);

            } catch (error) {
                console.error("An error occurred:", error);
                process.exit(1);
            }
        } catch (error) {
            console.error("An error occurred:", error);
            process.exit(1);
        }
    }
})();
