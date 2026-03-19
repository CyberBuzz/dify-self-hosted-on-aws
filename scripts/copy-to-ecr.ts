import { exec } from 'child_process';
import { promisify } from 'util';
import { props } from '../bin/cdk';

const execAsync = promisify(exec);

const difyImageTag = props.difyImageTag ?? 'latest';
const difySandboxImageTag = props.difySandboxImageTag ?? 'latest';
const difyPluginDaemonImageTag = props.difyPluginDaemonImageTag ?? 'main-local';
const repositoryName = props.customEcrRepositoryName;

const DOCKER_HUB_IMAGES = [
  `langgenius/dify-web:${difyImageTag}`,
  `langgenius/dify-api:${difyImageTag}`,
  `langgenius/dify-sandbox:${difySandboxImageTag}`,
  `langgenius/dify-plugin-daemon:${difyPluginDaemonImageTag}`,
];

interface AWSConfig {
  accountId: string;
  region: string;
}

async function getAWSConfig(): Promise<AWSConfig> {
  try {
    const { stdout: accountId } = await execAsync('aws sts get-caller-identity --query Account --output text');
    const region = props.awsRegion;

    return {
      accountId: accountId.trim(),
      region: region,
    };
  } catch (error) {
    throw new Error(`Failed to get AWS configuration: ${error}`);
  }
}

async function loginToECR(awsConfig: AWSConfig): Promise<void> {
  try {
    const { accountId, region } = awsConfig;
    const loginCommand = `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${accountId}.dkr.ecr.${region}.amazonaws.com`;
    await execAsync(loginCommand);
    console.log('Successfully logged in to ECR');
  } catch (error) {
    throw new Error(`Failed to login to ECR: ${error}`);
  }
}

async function ensureECRRepository(repositoryName: string, awsConfig: AWSConfig): Promise<void> {
  try {
    await execAsync(
      `aws ecr describe-repositories --repository-names "${repositoryName}" --region ${awsConfig.region}`,
    );
    console.log(`ECR repository already exists: ${repositoryName}`);
  } catch (error) {
    await execAsync(`aws ecr create-repository --repository-name "${repositoryName}" --region ${awsConfig.region}`);
    console.log(`ECR repository created: ${repositoryName}`);
  }
}

// Explicitly pull the amd64 image by digest instead of using `docker buildx imagetools create`,
// which doesn't work reliably on non-Docker-Desktop runtimes (e.g. colima).
async function getAmd64Digest(dockerHubImage: string): Promise<string> {
  const { stdout } = await execAsync(`docker manifest inspect "${dockerHubImage}" --verbose`);
  const manifests = JSON.parse(stdout);
  const list = Array.isArray(manifests) ? manifests : [manifests];
  for (const m of list) {
    const p = m.Descriptor?.platform ?? m.Platform ?? {};
    if (p.architecture === 'amd64' && p.os === 'linux') {
      return m.Descriptor?.digest ?? m.digest;
    }
  }
  throw new Error(`No amd64 manifest found for ${dockerHubImage}`);
}

async function processImage(dockerHubImage: string, repositoryName: string, awsConfig: AWSConfig): Promise<void> {
  try {
    const { accountId, region } = awsConfig;
    const ecrImageTag = dockerHubImage.replace(':', '_').replace('langgenius/', '');
    const ecrImageUri = `${accountId}.dkr.ecr.${region}.amazonaws.com/${repositoryName}:${ecrImageTag}`;
    const [repo] = dockerHubImage.split(':');

    const digest = await getAmd64Digest(dockerHubImage);
    const digestRef = `${repo}@${digest}`;
    await execAsync(`docker pull "${digestRef}"`);
    await execAsync(`docker tag "${digestRef}" "${ecrImageUri}"`);
    await execAsync(`docker push "${ecrImageUri}"`);
    console.log(`Successfully processed image: ${dockerHubImage} (amd64: ${digest.slice(0, 19)}...)`);
  } catch (error) {
    throw new Error(`Failed to process image ${dockerHubImage}: ${error}`);
  }
}

async function main(): Promise<void> {
  if (repositoryName == null) {
    console.log('Skipping image transfer process as custom repository is not specified');
    return;
  }

  console.log('Starting image transfer process');

  const awsConfig = await getAWSConfig();

  await loginToECR(awsConfig);
  await ensureECRRepository(repositoryName, awsConfig);

  for (const dockerHubImage of DOCKER_HUB_IMAGES) {
    console.log(`Processing image: ${dockerHubImage}`);
    await processImage(dockerHubImage, repositoryName, awsConfig);
  }

  console.log('All images have been processed successfully!');
}

main();
