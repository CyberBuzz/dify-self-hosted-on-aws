#!/usr/bin/env node
import 'dotenv/config';
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DifyOnAwsStack } from '../lib/dify-on-aws-stack';
import { UsEast1Stack } from '../lib/us-east-1-stack';
import { EnvironmentProps } from '../lib/environment-props';

const domainName = process.env.DIFY_DOMAIN_NAME;
const subDomain = domainName ? (process.env.DIFY_SUBDOMAIN ?? 'dify') : undefined;

export const props: EnvironmentProps = {
  awsRegion: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'ap-northeast-1',
  awsAccount: process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID,
  // Set Dify version
  difyImageTag: '1.13.3',
  // Set plugin-daemon version to stable release
  difyPluginDaemonImageTag: '0.5.3-local',
  // Set sandbox version
  difySandboxImageTag: '0.2.14',

  // uncomment the below options for less expensive configuration:
  isRedisMultiAz: false,
  useNatInstance: true,
  useFargateSpot: true,

  customEcrRepositoryName: 'dify-images',

  domainName,
  subDomain,
  useCloudFront: false,
  setupEmail: !!domainName,

  // Restrict console access by IP (comma-separated CIDRs)
  consoleAllowedIPv4Cidrs: process.env.CONSOLE_ALLOWED_CIDRS?.split(',').filter(Boolean),

  // Please see EnvironmentProps in lib/environment-props.ts for all the available properties
  additionalEnvironmentVariables: [
    {
      key: 'NOTION_INTERNAL_SECRET',
      value: { secretName: 'NOTION_INTERNAL_SECRET' },
      targets: ['api'],
    },
  ],
};

const app = new cdk.App();

let virginia: UsEast1Stack | undefined = undefined;
if ((props.useCloudFront ?? true) && (props.domainName || props.allowedIPv4Cidrs || props.allowedIPv6Cidrs)) {
  // add a unique suffix to prevent collision with different Dify instances in the same account.
  virginia = new UsEast1Stack(app, `DifyOnAwsUsEast1Stack${props.subDomain ? `-${props.subDomain}` : ''}`, {
    env: { region: 'us-east-1', account: props.awsAccount },
    crossRegionReferences: true,
    domainName: props.domainName,
    allowedIpV4AddressRanges: props.allowedIPv4Cidrs,
    allowedIpV6AddressRanges: props.allowedIPv6Cidrs,
  });
}

new DifyOnAwsStack(app, 'DifyOnAwsStack', {
  env: { region: props.awsRegion, account: props.awsAccount },
  crossRegionReferences: true,
  ...props,
  cloudFrontCertificate: virginia?.certificate,
  cloudFrontWebAclArn: virginia?.webAclArn,
});
