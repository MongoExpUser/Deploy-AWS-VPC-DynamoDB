/*
 ****************************************************************************************************************
 *                                                                                                              *
 * @License Starts                                                                                              *
 *                                                                                                              *
 * Copyright © 2020 - present. MongoExpUser.  All Rights Reserved.                                              *
 *                                                                                                              *
 * License: MIT - https://github.com/MongoExpUser/Create-AWS-VPC-DynamoDB-With-TypeScript-CDK/blob/main/LICENSE *
 *                                                                                                              *
 * @License Ends                                                                                                *
 ****************************************************************************************************************
 *                                                                                                              *
 *  This .ts module implements a STACK for creating:                                                            *
 *                                                                                                              *
 *  1) AWS VPC                                                                                                  *
 *                                                                                                              *
 *  2) AWS VPC-related resources                                                                                *
 *                                                                                                              *
 *  3) DynamoDB Table                                                                                           *
 ****************************************************************************************************************
*/


import { CfnDBSubnetGroup } from '@aws-cdk/aws-rds';
import { Table, BillingMode, AttributeType} from '@aws-cdk/aws-dynamodb';
import { Vpc, SubnetType, SecurityGroup, Subnet, Port, Peer} from '@aws-cdk/aws-ec2';
import { App, CfnOutput, Construct, Stack, StackProps, RemovalPolicy} from '@aws-cdk/core';


export class ResourcesCreationStack extends Stack{
  param: any;
  account: any;
  region: string;
  namePrefix: string;

  constructor(scope: App, id: string, props: StackProps, inputParametersObj:any) {
    super(scope, id, props);
    this.param = inputParametersObj;
    this.account = this.param.env.account;
    this.region = this.param.env.region;
    this.namePrefix = `${this.param.orgName}-${this.param.projectName}-${this.param.environment}-${this.param.regionName}`;
    
    // 1. Create vpc and all vpc-related resoources, to be used in creating other resources
    // a. create vpc with vpc-subnets
    // note 1: One NAT gateway/instance per Availability Zone, is created by default when public subet is created
    // note 2: the default route is setup for public subnet, so set natGateways to zero (0) if not needed
    const publicSubnet  = "public";
    const privateSubnet = "private";
    const isolatedSubnet  = "isolated";
    const vpc = new Vpc(this, "Vpc", {
      cidr: "10.0.0.0/16",
      natGateways: 0,
      vpnGateway: false,
      subnetConfiguration: [
        {cidrMask: 24, name: publicSubnet, subnetType: SubnetType.PUBLIC},
        {cidrMask: 28, name: isolatedSubnet, subnetType: SubnetType.ISOLATED},
        //If natGateways=0, then don't configure any PRIVATE subnets, so comment out
        //{cidrMask: 24, name: privateSubnet, subnetType: SubnetType.PRIVATE},
      ]
    });
    
    // b. create security group that allow incoming traffic on ports: 22 and this.param.port (i.e. db cluster port for access)
    // i. create the vpc-sgs
    const vpcOutBoundDescription = "Outbound: Allow SSH Access to EC2 instances"
    const sshIngressRuleDescription = "Ingress Rule: Allow SSH Access From Outside";
    const specifiedPortIngressRuleDescription = "Ingress Rule: Allow Access to Specified Port Access From Outside"
    const vpcSecurityGroup = new SecurityGroup(this, "VpcSecurityGroup", {
      vpc: vpc,
      securityGroupName : `${this.param.preOrPostFix}-vpc-sg`,
      description: vpcOutBoundDescription,
      allowAllOutbound: true
    });
    //ii. allow into the port (22)
    vpcSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(22),
      sshIngressRuleDescription
    );
    //iii. allow into the port (db port)
    vpcSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(Number(this.param.port)),
      specifiedPortIngressRuleDescription
    );
    
    // c. create subnetgroup for database access
    const subnetIds: string[] = [];
    const selection = vpc.selectSubnets({subnetType: SubnetType.ISOLATED});
    for(const subnet of selection.subnets) {
      subnetIds.push(subnet.subnetId);
    }
    const dbSubnetGroup = new CfnDBSubnetGroup(this, "DBSubnetGroup", {
      dbSubnetGroupDescription: this.param.dbSubnetGroupDescription,
      dbSubnetGroupName: `${this.param.preOrPostFix}-db-subet-grp`,
      subnetIds
    });
    
    // 2. Create DynamoDb table
    const dynamodbTable = new Table(this, "DynamoDBTable", {
      tableName: this.param.dynamodbTableName,
      partitionKey: {
        //note: partition key is the primary (or Hash) key -> other keys are created during put_item action
        name: this.param.dynamodbTablePartitionKey,
        type: AttributeType.STRING
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY
    });
  
    
    // 3. specify dependencies for orderly creation of resources
    vpcSecurityGroup.node.addDependency(vpc);
    dbSubnetGroup.node.addDependency(vpcSecurityGroup);
    dynamodbTable.node.addDependency(dbSubnetGroup);
    
    // 4. Create outputs:  Vpc, vpc-related resources and DynamoDB table
    // a. vpc and related resources
    // a(i). output vpc
    new CfnOutput(this, "VpcOutput", {
      exportName: "Vpc",
      value: String(vpc.vpcId),
      description: this.param.vpcDescription
    });
    // a(ii). output security group
    new CfnOutput(this, "VpcSecurityGroupOutput", {
      exportName:  "VpcSecurityGroup",
      value:  String(vpcSecurityGroup.securityGroupName),
      description: this.param.vpcSecurityGroupDescription
    });
    // a(iii). output db subnet group
    new CfnOutput(this, "DBSubnetGroupOutput", {
      exportName: "DBSubnetGroup",
      value:  String(dbSubnetGroup.dbSubnetGroupName),
      description: this.param.dbSubnetGroupDescription
    });
    // b. output dynamodb table
    new CfnOutput(this, "DynamoDBTableOutput", {
      exportName: "DynamoDBTable",
      value: String(`arn:aws:dynamodb:${this.region}:${this.account}:table/${this.param.dynamodbTableName}`),
      description: this.param.dynamodbTableDescription
    });
    
  }
}


export class InvokeResourcesCreationStack {
  constructor(){

    // declare & define parameters, instantiate STACK and create resources

    // 1. declare and define input parameters
    // a. naming, tagginng and environmental parameters
    const orgName: string = "org";
    const projectName: string = "proj";
    const environment: string = "dev";
    const regionName: string = "us-east-1";
    const tagKeyName: string = "name";
    const stackName: string = "vpc-dynamodb-stack";
    const stackId: string = "stack-id-" + orgName;
    const stackDescription: string = "Deploys VPC, VPC-Related Resources and DynamoDB Table with TypeScript CDK.";
    const env = {
      "account" : process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
      "region" :  process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
    };
    // b. vpc and vpc-related parameters
    const port: string = "443";
    const preOrPostFix: string  = orgName + "-" + projectName;
    const vpcDescription: string  = "Vpc for " + preOrPostFix;
    const vpcSecurityGroupDescription: string  = "Vpc Security Group for " + preOrPostFix;
    const dbSubnetGroupDescription: string  = "DB Subnet Group for " + preOrPostFix;
    // c. dynamodb parameters
    const dynamodbTableName: string = "renewable-energy";
    const dynamodbTablePartitionKey: string = "wind-speed-mips";
    const dynamodbTableDescription: string = "DynamoDB Table for " + preOrPostFix;
    // d. create a new object and store input parameters in the object
    const inputParametersObj = {
      // i. naming, tagginng and environmental parameters
      "orgName" : orgName,
      "projectName" : projectName,
      "environment" : environment,
      "regionName" : regionName,
      "tagKeyName" : tagKeyName,
      "stackName" :  stackName,
      "stackId" :  stackId,
      "stackDescription" : stackDescription,
      "env" : env,
      // ii. vpc and vpc-related parameters
      "port" : port,
      "preOrPostFix" : preOrPostFix,
      "vpcDescription" : vpcDescription,
      "vpcSecurityGroupDescription" : vpcSecurityGroupDescription,
      "dbSubnetGroupDescription" : dbSubnetGroupDescription,
      // iii. dynamodb parameters
      "dynamodbTableName" : dynamodbTableName,
      "dynamodbTablePartitionKey" : dynamodbTablePartitionKey,
      "dynamodbTableDescription" : dynamodbTableDescription
    }
    
    // 2 create props option object and store relevant STACK parameters (inclusding env) in the object
    const propsOptions: any = {
      env: env,
      stackId: stackId,
      stackName: stackName,
      description: stackDescription,
      terminationProtection: true,
      analyticsReporting: true
    }
    
    // 3. instantiate STACK; pass in stackId, propsOptions & inputParametersObj; to create resources
    const createResource = new ResourcesCreationStack(new App(), stackId, propsOptions, inputParametersObj);
  }
}


const createResources = new InvokeResourcesCreationStack();
