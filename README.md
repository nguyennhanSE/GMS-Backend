<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Production Configuration

Copy `.env.prod.example` to `.env.prod` before running `npm run start:prod`.

Production startup now fails fast when required runtime variables are missing. The template groups variables into:

- change from local development
- add in production because `.env.dev` does not define them yet
- keep the same as local development when the same behavior is intended

For Render-native deployment:

- set `APP_RUNTIME_ROLE=web` on the web service
- set `APP_RUNTIME_ROLE=worker` on the background worker
- keep `APP_RUNTIME_ROLE=all` for local/dev only
- use `/api/v1/health` as the web service health check path
- start with `REDIS_ENABLED=false` unless a managed Redis instance is provisioned

For baseline production catalog data only, use:

```bash
npm run seed:prod
```

`seed:prod` only upserts roles, membership tiers, gym class templates, and exercises. It does not create demo users, trainer availability, schedules, or bookings.

For an explicit production demo-user seed, use:

```bash
npm run seed:demo-users:prod
```

`seed:demo-users:prod` forces `NODE_ENV=production`, loads `.env.prod`, and only upserts demo users plus their role links. It does not create memberships, relational trainer availability rows, schedules, bookings, or payments.

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# Playwright API e2e tests
$ npm run test:api

# test coverage
$ npm run test:cov
```

Playwright API target switch:

```bash
# default local mode
$ npm run test:api

# deployed non-production mode
$ PLAYWRIGHT_TARGET=deployed PLAYWRIGHT_DEPLOY_ENV=staging API_BASE_URL=https://your-staging-host/api/v1/ PLAYWRIGHT_DATABASE_URL=postgresql://... npm run test:api
```

PowerShell:

```powershell
$env:PLAYWRIGHT_TARGET='deployed'
$env:PLAYWRIGHT_DEPLOY_ENV='staging'
$env:API_BASE_URL='https://your-staging-host/api/v1/'
$env:PLAYWRIGHT_DATABASE_URL='postgresql://...'
npm run test:api
```

Rules:

- `PLAYWRIGHT_TARGET=local` is the default and auto-starts the local API harness
- `PLAYWRIGHT_TARGET=deployed` disables the local Playwright `webServer` and requires both `API_BASE_URL` and `PLAYWRIGHT_DATABASE_URL`
- deployed mode is blocked when `PLAYWRIGHT_DEPLOY_ENV=production`
- some specs remain local-only because they depend on temporary process-level env overrides or the in-process SMTP harness
- `PLAYWRIGHT_DATABASE_URL` must point to the same database backing `API_BASE_URL`, otherwise fixture seeding and API login will drift apart

## Deployment

This repository now includes [`render.yaml`](render.yaml) for a Render-native production topology:

- `gms-backend-web`: HTTP API service
- `gms-backend-worker`: RabbitMQ consumers and cron ownership

Operational rules:

- Render Postgres is provided through `DATABASE_URL`
- Railway RabbitMQ is provided through `RABBITMQ_URL`
- the worker must fail hard if DB or RabbitMQ startup fails
- the web service must serve HTTP without starting worker-only background processing

Set the remaining secrets and URLs in Render before deploying. Use `.env.prod.example` as the env key checklist.

## Docker Image Deploys

If the hosting platform cannot access the GitHub repository directly, you can deploy the worker from a registry image instead of a connected repo.

- build the worker image from `Dockerfile.worker`
- deploy that image as `APP_RUNTIME_ROLE=worker`
- keep the web service on Render
- run `npm run db:deploy` as a separate release step, not on worker startup

See [`docs/docker-image-deployment-walkthrough.md`](docs/docker-image-deployment-walkthrough.md) for the registry-based workflow.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
