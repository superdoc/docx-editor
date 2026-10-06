import assert from "node:assert/strict";
import test from "node:test";

import {
  collectContributors,
  embedAvatars,
  renderContributorSvg,
} from "../generate-contributors.mjs";

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

test("combines branch histories and counts each person once per unique commit", async () => {
  const pages = new Map([
    [
      "refs/heads/main:",
      {
        oid: "main-head",
        nodes: [
          {
            oid: "shared",
            authors: {
              nodes: [
                {
                  user: {
                    avatarUrl: "https://avatars.test/alice",
                    databaseId: 1,
                    login: "Alice",
                    url: "https://github.com/Alice",
                  },
                },
                {
                  user: {
                    avatarUrl: "https://avatars.test/alice",
                    databaseId: 1,
                    login: "Alice",
                    url: "https://github.com/Alice",
                  },
                },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        ],
        pageInfo: { endCursor: "main-next", hasNextPage: true },
      },
    ],
    [
      "main-head:main-next",
      {
        oid: "main-head",
        nodes: [
          {
            oid: "main-only",
            authors: {
              nodes: [
                {
                  user: {
                    avatarUrl: "https://avatars.test/bob",
                    databaseId: 2,
                    login: "bob",
                    url: "https://github.com/bob",
                  },
                },
                {
                  user: {
                    avatarUrl: "https://avatars.test/bot",
                    databaseId: 3,
                    login: "release[bot]",
                    url: "https://github.com/apps/release",
                  },
                },
                {
                  user: {
                    avatarUrl: "https://avatars.test/agent",
                    databaseId: 4,
                    login: "cursoragent",
                    url: "https://github.com/cursoragent",
                  },
                },
                {
                  user: {
                    avatarUrl: "https://avatars.test/release",
                    databaseId: 5,
                    login: "semantic-release-bot",
                  },
                },
                { user: null },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        ],
        pageInfo: { endCursor: null, hasNextPage: false },
      },
    ],
    [
      "refs/heads/v1:",
      {
        oid: "v1-head",
        nodes: [
          {
            oid: "shared",
            authors: {
              nodes: [
                {
                  user: {
                    avatarUrl: "https://avatars.test/alice",
                    databaseId: 1,
                    login: "Alice",
                    url: "https://github.com/Alice",
                  },
                },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
          {
            oid: "v1-only",
            authors: {
              nodes: [
                {
                  user: {
                    avatarUrl: "https://avatars.test/alice",
                    databaseId: 1,
                    login: "Alice",
                    url: "https://github.com/Alice",
                  },
                },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        ],
        pageInfo: { endCursor: null, hasNextPage: false },
      },
    ],
  ]);
  const fetchFn = async (_url, options) => {
    const { variables } = JSON.parse(options.body);
    const page = pages.get(`${variables.expression}:${variables.cursor ?? ""}`);
    return jsonResponse({
      data: { repository: { object: { oid: page.oid, history: page } } },
    });
  };

  const contributors = await collectContributors({
    fetchFn,
    repository: "superdoc/docx-editor",
    token: "test",
  });

  assert.deepEqual(
    contributors.map(({ login, contributions }) => ({ login, contributions })),
    [
      { login: "Alice", contributions: 2 },
      { login: "bob", contributions: 1 },
    ],
  );
});

test("embeds avatar bytes and renders a deterministic SVG grid", async () => {
  const contributors = [
    {
      avatarUrl: "https://avatars.test/alice?old=1",
      contributions: 2,
      id: 1,
      login: "Alice & Co",
      url: "https://github.com/Alice",
    },
    {
      avatarUrl: "https://avatars.test/bob",
      contributions: 1,
      id: 2,
      login: "bob",
      url: "https://github.com/bob",
    },
  ];
  const requests = [];
  const fetchFn = async (url) => {
    requests.push(String(url));
    return new Response(Uint8Array.from([1, 2, 3]), {
      headers: { "content-type": "image/png" },
    });
  };

  const embedded = await embedAvatars(contributors, { fetchFn });
  const svg = renderContributorSvg(embedded, { columns: 1 });

  assert.deepEqual(requests, [
    "https://avatars.test/alice?old=1&size=128",
    "https://avatars.test/bob?size=128",
  ]);
  assert.match(svg, /width="64" height="132"/);
  assert.match(svg, /Alice &amp; Co — 2 contributions/);
  assert.equal((svg.match(/data:image\/png;base64,AQID/g) ?? []).length, 2);
});

test("fails closed when a commit author list is truncated", async () => {
  const fetchFn = async () =>
    jsonResponse({
      data: {
        repository: {
          object: {
            oid: "head",
            history: {
              nodes: [
                {
                  oid: "crowded",
                  authors: { nodes: [], pageInfo: { hasNextPage: true } },
                },
              ],
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        },
      },
    });

  await assert.rejects(
    () =>
      collectContributors({
        fetchFn,
        repository: "superdoc/docx-editor",
        refs: ["main"],
        token: "test",
      }),
    /more than 20 authors/,
  );
});

test("fails closed when a configured branch does not resolve", async () => {
  const fetchFn = async () =>
    jsonResponse({ data: { repository: { object: null } } });

  await assert.rejects(
    () =>
      collectContributors({
        fetchFn,
        repository: "superdoc/docx-editor",
        refs: ["refs/heads/v1"],
        token: "test",
      }),
    /refs\/heads\/v1.*does not resolve/,
  );
});
