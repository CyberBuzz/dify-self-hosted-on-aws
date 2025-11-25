#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DifyOnAwsStack } from '../lib/dify-on-aws-stack';
import { UsEast1Stack } from '../lib/us-east-1-stack';
import { EnvironmentProps } from '../lib/environment-props';

const subDomain = 'dify';
const domainName = 'aibase.buzz';

export const props: EnvironmentProps = {
  awsRegion: 'ap-northeast-1', // Tokyo region
  awsAccount: '130713583835',
  // Set Dify version
  difyImageTag: '1.11.1',
  // Set plugin-daemon version to stable release
  difyPluginDaemonImageTag: '0.5.1-local',

  // uncomment the below options for less expensive configuration:
  isRedisMultiAz: false,
  useNatInstance: true,
  useFargateSpot: true,

  customEcrRepositoryName: 'dify-images',

  domainName,
  subDomain,
  useCloudFront: false,

  // Please see EnvironmentProps in lib/environment-props.ts for all the available properties
  additionalEnvironmentVariables: [
    {
      key: 'NOTION_INTERNAL_SECRET',
      value: { secretName: 'NOTION_INTERNAL_SECRET'},
      targets: ['api'], 
    }
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
