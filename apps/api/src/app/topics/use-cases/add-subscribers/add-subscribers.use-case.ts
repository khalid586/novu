import { TopicSubscribersRepository, TopicEntity, TopicRepository, CreateTopicSubscribersEntity } from '@novu/dal';
import { SubscriberDto } from '@novu/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ExternalSubscriberId } from '../../types';

import { AddSubscribersCommand } from './add-subscribers.command';

import { CreateTopicUseCase, CreateTopicCommand } from '../create-topic';

import { SearchByExternalSubscriberIds, SearchByExternalSubscriberIdsCommand } from '../../../subscribers/usecases';

interface ISubscriberGroups {
  existingExternalSubscribers: ExternalSubscriberId[];
  nonExistingExternalSubscribers: ExternalSubscriberId[];
  subscribersAvailableToAdd: SubscriberDto[];
}

@Injectable()
export class AddSubscribersUseCase {
  constructor(
    private createTopic: CreateTopicUseCase,
    private searchByExternalSubscriberIds: SearchByExternalSubscriberIds,
    private topicSubscribersRepository: TopicSubscribersRepository,
    private topicRepository: TopicRepository
  ) {}

  async execute(command: AddSubscribersCommand): Promise<Omit<ISubscriberGroups, 'subscribersAvailableToAdd'>> {
    let topic = await this.topicRepository.findTopicByKey(
      command.topicKey,
      command.organizationId,
      command.environmentId
    );

    if (!topic) {
      const createTopicCommand = CreateTopicCommand.create({
        environmentId: command.environmentId,
        key: command.topicKey,
        // TODO: Maybe make more clear that is a provisional name
        name: `Topic-On-The-Fly-${command.topicKey}`,
        organizationId: command.organizationId,
      });
      topic = await this.createTopic.execute(createTopicCommand);
    }

    const { existingExternalSubscribers, nonExistingExternalSubscribers, subscribersAvailableToAdd } =
      await this.filterExistingSubscribers(command);

    if (subscribersAvailableToAdd.length > 0) {
      const topicSubscribers = this.mapSubscribersToTopic(topic, subscribersAvailableToAdd);
      await this.topicSubscribersRepository.addSubscribers(topicSubscribers);
    }

    return {
      existingExternalSubscribers,
      nonExistingExternalSubscribers,
    };
  }

  private async filterExistingSubscribers(command: AddSubscribersCommand): Promise<ISubscriberGroups> {
    const searchByExternalSubscriberIdsCommand = SearchByExternalSubscriberIdsCommand.create({
      environmentId: command.environmentId,
      organizationId: command.organizationId,
      externalSubscriberIds: command.subscribers,
    });
    const foundSubscribers = await this.searchByExternalSubscriberIds.execute(searchByExternalSubscriberIdsCommand);

    return this.groupSubscribersIfBelonging(command.subscribers, foundSubscribers);
  }

  /**
   * Time complexity: 0(n)
   */
  private groupSubscribersIfBelonging(
    subscribers: ExternalSubscriberId[],
    foundSubscribers: SubscriberDto[]
  ): ISubscriberGroups {
    const subscribersList = new Set<ExternalSubscriberId>(subscribers);
    const subscribersAvailableToAdd = new Set<SubscriberDto>();
    const existingExternalSubscribersList = new Set<ExternalSubscriberId>();

    for (const foundSubscriber of foundSubscribers) {
      existingExternalSubscribersList.add(foundSubscriber.subscriberId);
      subscribersList.delete(foundSubscriber.subscriberId);
      subscribersAvailableToAdd.add(foundSubscriber);
    }

    return {
      existingExternalSubscribers: Array.from(existingExternalSubscribersList),
      nonExistingExternalSubscribers: Array.from(subscribersList),
      subscribersAvailableToAdd: Array.from(subscribersAvailableToAdd),
    };
  }

  private mapSubscribersToTopic(topic: TopicEntity, subscribers: SubscriberDto[]): CreateTopicSubscribersEntity[] {
    return subscribers.map((subscriber) => ({
      _environmentId: subscriber._environmentId,
      _organizationId: subscriber._organizationId,
      _subscriberId: subscriber._id,
      _topicId: topic._id,
      topicKey: topic.key,
      externalSubscriberId: subscriber.subscriberId,
    }));
  }
}
