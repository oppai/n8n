import { type InstalledNodes, type InstalledPackages, type User } from '@n8n/db';
import { CredentialsRepository, InstalledNodesRepository, UserRepository } from '@n8n/db';
import { Container } from '@n8n/di';
import { Flags } from '@oclif/core';

import { CredentialsService } from '@/credentials/credentials.service';
import { CommunityPackagesService } from '@/services/community-packages.service';
import { CommunityNodeTypesService } from '@/services/community-node-types.service';

import { BaseCommand } from './base-command';

export class CommunityNode extends BaseCommand {
       static description = '\nInstall or uninstall a community node and its credentials';

	static examples = [
               '$ n8n community-node --install --package n8n-nodes-evolution-api',
               '$ n8n community-node --uninstall --package n8n-nodes-evolution-api',
               '$ n8n community-node --uninstall --credential evolutionApi --userId 1234',
	];

	static flags = {
		help: Flags.help({ char: 'h' }),
               uninstall: Flags.boolean({
                       description: 'Uninstalls the node',
               }),
               install: Flags.boolean({
                       description: 'Installs the node',
               }),
               package: Flags.string({
                       description: 'Package name of the community node.',
               }),
               version: Flags.string({
                       description: 'Version of the community node package',
               }),
               verify: Flags.boolean({
                       description: 'Only install if the package is vetted',
               }),
               credential: Flags.string({
                       description:
                               "Type of the credential.\nGet this value by visiting the node's .credential.ts file and getting the value of `name`",
               }),
		userId: Flags.string({
			description:
				'The ID of the user who owns the credential.\nOn self-hosted, query the database.\nOn cloud, query the API with your API key',
		}),
	};

	async init() {
		await super.init();
	}

	async run() {
		const { flags } = await this.parseFlags();

               const packageName = flags.package;
               const credentialType = flags.credential;
               const userId = flags.userId;
               const verify = Boolean(flags.verify);
               const version = flags.version;

               const install = flags.install;
               const uninstall = flags.uninstall;

               if (!flags) {
                       this.logger.info('Please set flags. See help for more information.');
                       return;
               }

               if (!install && !uninstall) {
                       this.logger.info('"--install" or "--uninstall" has to be set!');
                       return;
               }

               if (install && uninstall) {
                       this.logger.info('Please specify only one of "--install" or "--uninstall"');
                       return;
               }

               if (uninstall && !packageName && !credentialType) {
                       this.logger.info('"--package" or "--credential" has to be set!');
                       return;
               }

               if (install && !packageName) {
                       this.logger.info('"--package" has to be set!');
                       return;
               }

               if (install && packageName) {
                       await this.installPackage(packageName, verify, version);
                       return;
               }

               if (uninstall && packageName) {
                       await this.uninstallPackage(packageName);
                       return;
               }

		if (credentialType && userId) {
			await this.uninstallCredential(credentialType, userId);
		} else {
			this.logger.info('"--userId" has to be set!');
		}
	}

	async catch(error: Error) {
		this.logger.error('Error in node command:');
		this.logger.error(error.message);
	}

	async uninstallCredential(credentialType: string, userId: string) {
		const user = await this.findUserById(userId);

		if (user === null) {
			this.logger.info(`User ${userId} not found`);
			return;
		}

		const credentials = await this.findCredentialsByType(credentialType);

		if (credentials === null) {
			this.logger.info(`Credentials with type ${credentialType} not found`);
			return;
		}

		credentials.forEach(async (credential) => {
			await this.deleteCredential(user, credential.id);
		});

		this.logger.info(`All credentials with type ${credentialType} successfully uninstalled`);
	}

	async findUserById(userId: string) {
		return await Container.get(UserRepository).findOneBy({ id: userId });
	}

	async findCredentialsByType(credentialType: string) {
		return await Container.get(CredentialsRepository).findBy({ type: credentialType });
	}

	async deleteCredential(user: User, credentialId: string) {
		return await Container.get(CredentialsService).delete(user, credentialId);
	}

        async uninstallPackage(packageName: string) {
                const communityPackage = await this.findCommunityPackage(packageName);

		if (communityPackage === null) {
			this.logger.info(`Package ${packageName} not found`);
			return;
		}

		await this.removeCommunityPackage(packageName, communityPackage);

		const installedNodes = communityPackage?.installedNodes;

		if (!installedNodes) {
			this.logger.info(`Nodes in ${packageName} not found`);
			return;
		}

		for (const node of installedNodes) {
			await this.deleteCommunityNode(node);
		}

                await this.pruneDependencies();
        }

       async installPackage(packageName: string, verify: boolean, version?: string) {
               let checksum: string | undefined;

               if (verify) {
                       const vetted = Container.get(CommunityNodeTypesService).findVetted(packageName);
                       if (!vetted) {
                               this.logger.info(`Package ${packageName} is not vetted for installation`);
                               return;
                       }
                       checksum = vetted.checksum;
               }

               try {
                       await Container.get(CommunityPackagesService).installPackage(
                               packageName,
                               version,
                               checksum,
                       );
                       this.logger.info(`Package ${packageName} installed successfully`);
               } catch (error) {
                       this.logger.error('Failed to install package');
                       if (error instanceof Error) this.logger.error(error.message);
               }
       }

	async pruneDependencies() {
		await Container.get(CommunityPackagesService).executeNpmCommand('npm prune');
	}

	async parseFlags() {
		return await this.parse(CommunityNode);
	}

	async deleteCommunityNode(node: InstalledNodes) {
		return await Container.get(InstalledNodesRepository).delete({
			type: node.type,
		});
	}

	async removeCommunityPackage(packageName: string, communityPackage: InstalledPackages) {
		return await Container.get(CommunityPackagesService).removePackage(
			packageName,
			communityPackage,
		);
	}

	async findCommunityPackage(packageName: string) {
		return await Container.get(CommunityPackagesService).findInstalledPackage(packageName);
	}
}
