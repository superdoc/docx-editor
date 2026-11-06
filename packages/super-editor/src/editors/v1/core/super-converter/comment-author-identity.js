import * as xmljs from 'xml-js';
import { stableHexHash } from '../utilities/hash.js';
import { carbonCopy } from '../utilities/carbonCopy.js';
import { serializeOpcXml } from '../opc/xml-serialization.js';
import { snapshotWordIdentity } from '@superdoc/common/helpers/word-identity';

export const PEOPLE_NAMESPACE = 'http://schemas.microsoft.com/office/word/2012/wordml';
export const PEOPLE_RELATIONSHIP = 'http://schemas.microsoft.com/office/2011/relationships/people';
export const PEOPLE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml';
const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RELS_PATH = 'word/_rels/document.xml.rels';

const scopeFor = (node, parent = {}) => {
  const scope = { ...parent };
  for (const [key, value] of Object.entries(node.attributes || {})) {
    if (key === 'xmlns') scope[''] = value;
    else if (key.startsWith('xmlns:')) scope[key.slice(6)] = value;
  }
  return scope;
};
const isName = (name, local, namespace, scope, attribute = false) => {
  const split = name?.split(':') || [];
  return split.at(-1) === local && (split.length === 2 ? scope[split[0]] : attribute ? '' : scope['']) === namespace;
};
const attribute = (node, local, namespace, scope) =>
  Object.entries(node.attributes || {}).find(([name]) => isName(name, local, namespace, scope, true))?.[1];
const children = (node, local, namespace, scope) =>
  (node.elements || []).filter((child) => isName(child.name, local, namespace, scopeFor(child, scope)));
function walk(node, callback, parent = {}) {
  const scope = scopeFor(node, parent);
  callback(node, scope);
  for (const child of node.elements || []) walk(child, callback, scope);
}
const pairKey = (identity) => identity && JSON.stringify([identity.providerId, identity.userId]);
const accountKey = (name, identity) => JSON.stringify([name, 'provider', identity.providerId, identity.userId]);

const commentOwnerKey = (comment, identity) => {
  const name = comment.creatorName || comment.importedAuthor?.name || 'Unknown';
  const fallback =
    comment.creatorId != null
      ? ['id', comment.creatorId]
      : comment.creatorEmail
        ? ['email', comment.creatorEmail]
        : ['comment', comment.commentId];
  return identity ? accountKey(name, identity) : JSON.stringify([name, 'fallback', ...fallback]);
};

/** Retain all imported people text before append/export, without changing generic OOXML parsing. */
export function preservePeopleWhitespace(rawXml, parsedTree) {
  const root = parsedTree?.elements?.find((node) => node.type === 'element');
  return root && isName(root.name, 'people', PEOPLE_NAMESPACE, scopeFor(root))
    ? xmljs.xml2js(rawXml, { captureSpacesBetweenElements: true })
    : parsedTree;
}

/** Resolve an internal relationship relative to word/document.xml without escaping the package. */
export function resolvePeopleTarget(target) {
  if (typeof target !== 'string' || !target || /[\\:#?]/u.test(target)) return undefined;
  const segments = target.startsWith('/') ? [] : ['word'];
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) return undefined;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.length ? segments.join('/') : undefined;
}

/** Read only expanded-name Word people nodes, retaining the complete original tree for append-only export. */
export function readPeopleRelationship(relationships) {
  const relations = [];
  walk(relationships || {}, (node, scope) => {
    if (isName(node.name, 'Relationship', REL_NAMESPACE, scope) && node.attributes?.Type === PEOPLE_RELATIONSHIP) {
      relations.push(node);
    }
  });
  if (!relations.length) return { people: [] };
  if (relations.length !== 1)
    return { people: [], error: 'Ambiguous people relationships; imported data was preserved.' };
  const relation = relations[0];
  const path =
    relation.attributes.TargetMode === 'External' ? undefined : resolvePeopleTarget(relation.attributes.Target);
  if (!path) return { error: 'Unsafe people relationship; imported data was preserved.' };
  return { path };
}

export function readPeoplePart(convertedXml) {
  const relationship = readPeopleRelationship(convertedXml[RELS_PATH]);
  if (!relationship.path) return { people: [], ...relationship };
  const { path } = relationship;
  const tree = convertedXml[path];
  const root = tree?.elements?.find((node) => isName(node.name, 'people', PEOPLE_NAMESPACE, scopeFor(node)));
  if (!root) return { people: [], error: 'Unsafe or missing people part; imported data was preserved.' };
  const rootScope = scopeFor(root);
  const people = children(root, 'person', PEOPLE_NAMESPACE, rootScope).map((node) => {
    const scope = scopeFor(node, rootScope);
    const author = attribute(node, 'author', PEOPLE_NAMESPACE, scope);
    const presence = children(node, 'presenceInfo', PEOPLE_NAMESPACE, scope);
    const pairs = presence.map((item) => {
      const itemScope = scopeFor(item, scope);
      const providerId = attribute(item, 'providerId', PEOPLE_NAMESPACE, itemScope);
      const userId = attribute(item, 'userId', PEOPLE_NAMESPACE, itemScope);
      return typeof providerId === 'string' && typeof userId === 'string' ? { providerId, userId } : undefined;
    });
    const identity = pairs.length === 1 ? pairs[0] : undefined;
    return { author, identity };
  });
  return { path, tree, root, people };
}

export function importedWordIdentity(people, author) {
  const matches = people.filter((person) => person.author === author);
  if (!matches.length || matches.some((person) => !person.identity)) return undefined;
  return new Set(matches.map((person) => pairKey(person.identity))).size === 1 ? { ...matches[0].identity } : undefined;
}

/** Read the standard source ID/name projection without consulting caller metadata. */
export function readCommentAuthorSourceRows(tree) {
  const root = tree?.elements?.find((node) => node.type === 'element');
  if (!root || !isName(root.name, 'comments', WORD_NAMESPACE, scopeFor(root))) return undefined;
  const rows = new Map();
  const scope = scopeFor(root);
  for (const node of children(root, 'comment', WORD_NAMESPACE, scope)) {
    const nodeScope = scopeFor(node, scope);
    const name = attribute(node, 'author', WORD_NAMESPACE, nodeScope);
    const importedId = attribute(node, 'id', WORD_NAMESPACE, nodeScope);
    const time = new Date(attribute(node, 'date', WORD_NAMESPACE, nodeScope)).getTime();
    const internalId = attribute(node, 'internalId', WORD_NAMESPACE, nodeScope);
    const id =
      internalId ??
      (importedId != null && Number.isFinite(time) ? `imported-${stableHexHash(`${importedId}-${time}`)}` : undefined);
    if (id === undefined || typeof name !== 'string' || rows.has(String(id))) return undefined;
    rows.set(String(id), name);
  }
  return rows;
}

/** Transport generated ownership with the comments part, never as package XML or account assertions. */
export function generatedCommentAuthorRows(tree, source) {
  return [...(readCommentAuthorSourceRows(tree) || [])].filter(
    ([id]) => source?.version === 1 && source.localCommentIds.has(id) && !source.comments.has(id),
  );
}

/** Only raw/schema import and committed comments ingress may establish source ownership. */
export function captureCommentAuthorSource(convertedXml, comments = [], previous, generatedRows = []) {
  const source =
    previous?.version === 1
      ? previous
      : {
          version: 1,
          names: new Set(),
          comments: new Map(),
          localCommentIds: new Set(),
        };
  const names = new Set(source.names);
  // Non-comment annotation reservations are trusted only at the initial raw import.
  if (!previous) {
    for (const [path, tree] of Object.entries(convertedXml)) {
      if (path === 'word/comments.xml' || !tree || typeof tree !== 'object') continue;
      walk(tree, (node, scope) => {
        const name = attribute(node, 'author', WORD_NAMESPACE, scope);
        if (name !== undefined) names.add(name);
      });
    }
  }
  const records = new Map(source.comments);
  const localCommentIds = new Set(source.localCommentIds);
  const rows = readCommentAuthorSourceRows(convertedXml['word/comments.xml']);
  // Only committed transport metadata can classify incoming generated rows. Bind it to
  // the actual ID/name projection, and never demote an already imported source record.
  if (previous?.version === 1 && Array.isArray(generatedRows)) {
    for (const row of generatedRows) {
      if (
        Array.isArray(row) &&
        row.length === 2 &&
        typeof row[0] === 'string' &&
        typeof row[1] === 'string' &&
        rows?.get(row[0]) === row[1] &&
        !records.has(row[0])
      )
        localCommentIds.add(row[0]);
    }
  }
  const people = readPeoplePart(convertedXml).people;
  for (const [id, name] of rows || []) {
    if (localCommentIds.has(id)) continue;
    // Keep captured imported values for validation, even after the current association changes.
    records.set(id, {
      ...records.get(id),
      name,
      identity: records.has(id) ? records.get(id).identity : importedWordIdentity(people, name),
      validationIdentities: new Set(records.get(id)?.validationIdentities),
    });
    names.add(name);
  }
  // This array is the actual schema-import result, including parser-generated fallback IDs.
  for (const comment of comments) {
    const id = String(comment.commentId);
    if (localCommentIds.has(id)) continue;
    const name = records.get(id)?.name ?? comment.wordAuthorName;
    records.set(id, {
      ...records.get(id),
      name,
      identity: records.has(id) ? records.get(id).identity : comment.creatorIdentity && { ...comment.creatorIdentity },
      validationIdentities: new Set(records.get(id)?.validationIdentities),
    });
    if (name !== undefined) names.add(name);
  }
  return { version: 1, names, comments: records, localCommentIds };
}

/** Negative evidence for legacy recovery: a room seed must not contain our allocated local rows. */
export function hasLocalCommentAuthorSourceConflict(rows, comments, assignments) {
  return comments.some((comment) => {
    const name = rows.get(String(comment.commentId));
    return name !== undefined && assignments.get(commentOwnerKey(comment, comment.creatorIdentity)) === name;
  });
}

/** Allocate export-only labels and append new people without changing source comments, XML or the room. */
export function prepareCommentAuthors({
  convertedXml,
  comments,
  validationComments = comments,
  source,
  assignments = new Map(),
  hash = stableHexHash,
}) {
  const peoplePart = readPeoplePart(convertedXml);
  if (peoplePart.error) throw new Error(peoplePart.error);
  const warnings = [];
  const reserved = new Map();
  const nextAssignments = new Map(assignments);
  for (const person of peoplePart.people) {
    if (person.author === undefined) continue;
    const identity = importedWordIdentity(peoplePart.people, person.author);
    reserved.set(person.author, identity ? accountKey(person.author, identity) : null);
    if (!identity) warnings.push(`Unresolved imported Word author: ${person.author}`);
  }
  for (const name of source.names) if (!reserved.has(name)) reserved.set(name, null);
  for (const [owner, label] of assignments) if (!reserved.has(label)) reserved.set(label, owner);

  // Validate caller assertions even when an export mode omits those comments.
  for (const comment of validationComments) {
    const imported = source.comments.get(String(comment.commentId));
    const identityKey = pairKey(comment.creatorIdentity);
    const currentIdentity = imported && importedWordIdentity(peoplePart.people, imported.name);
    if (
      comment.creatorIdentity !== undefined &&
      identityKey !== pairKey(imported?.identity) &&
      !(imported && identityKey === pairKey(currentIdentity)) &&
      !imported?.validationIdentities?.has(identityKey)
    ) {
      snapshotWordIdentity(comment.creatorIdentity);
    }
  }
  const groups = new Map();
  const prepared = comments.map((comment) => {
    const imported = source.comments.get(String(comment.commentId));
    if (imported?.name !== undefined) {
      // The original annotation owns this label even if the active user has since changed.
      return {
        ...comment,
        wordAuthorName: imported.name,
        creatorIdentity: importedWordIdentity(peoplePart.people, imported.name),
      };
    }
    const identity = snapshotWordIdentity(comment.creatorIdentity);
    const name = comment.creatorName || comment.importedAuthor?.name || 'Unknown';
    const owner = commentOwnerKey(comment, identity);
    if (!groups.has(owner)) groups.set(owner, { name, identity, comments: [] });
    const copy = { ...comment, creatorIdentity: identity };
    groups.get(owner).comments.push(copy);
    return copy;
  });
  const ownersByName = new Map();
  for (const [owner, group] of groups) {
    if (!ownersByName.has(group.name)) ownersByName.set(group.name, []);
    ownersByName.get(group.name).push(owner);
  }
  // Reserve every literal name before assigning aliases, including suffix-looking display names.
  for (const [name, owners] of ownersByName) {
    if (!reserved.has(name)) reserved.set(name, owners.length === 1 ? owners[0] : null);
  }
  const additions = [];
  for (const owner of [...groups.keys()].sort()) {
    const group = groups.get(owner);
    let label = nextAssignments.get(owner);
    if (!label || reserved.get(label) !== owner) {
      label = group.name;
      if (reserved.get(label) !== owner) {
        const base = `${group.name} [sd-${hash(owner)}]`;
        label = base;
        let index = 2;
        while (reserved.has(label) && reserved.get(label) !== owner) label = `${base.slice(0, -1)}-${index++}]`;
      }
    }
    reserved.set(label, owner);
    nextAssignments.set(owner, label);
    for (const comment of group.comments) comment.wordAuthorName = label;
    if (
      group.identity &&
      !peoplePart.people.some((p) => p.author === label && pairKey(p.identity) === pairKey(group.identity))
    ) {
      additions.push({ label, identity: group.identity });
    }
  }

  let part;
  if (peoplePart.path || additions.length) {
    let path = peoplePart.path || 'word/people.xml';
    let index = 2;
    while (!peoplePart.path && convertedXml[path]) path = `word/people${index++}.xml`;
    const tree = peoplePart.tree
      ? carbonCopy(peoplePart.tree)
      : {
          elements: [
            { type: 'element', name: 'w15:people', attributes: { 'xmlns:w15': PEOPLE_NAMESPACE }, elements: [] },
          ],
        };
    const root = tree.elements.find((node) => isName(node.name, 'people', PEOPLE_NAMESPACE, scopeFor(node)));
    root.elements ||= [];
    for (const { label, identity } of additions) {
      // Local binding avoids changing existing prefixes, including shadowed or vendor-owned w15 declarations.
      root.elements.push({
        type: 'element',
        name: 'w15:person',
        attributes: { 'xmlns:w15': PEOPLE_NAMESPACE, 'w15:author': label },
        elements: [
          {
            type: 'element',
            name: 'w15:presenceInfo',
            attributes: { 'w15:providerId': identity.providerId, 'w15:userId': identity.userId },
          },
        ],
      });
    }
    part = { path, tree, unchanged: additions.length === 0 };
  }
  const localCommentIds = new Set(source.localCommentIds);
  for (const comment of validationComments) {
    const id = String(comment.commentId);
    if (!source.comments.has(id)) localCommentIds.add(id);
  }
  // Remember only genuine current Word tuples for already-owned source IDs. This is validation
  // evidence, not a binding: output above always uses the current people lookup.
  const sourceComments = new Map(source.comments);
  for (const [id, record] of source.comments) {
    const currentIdentity = importedWordIdentity(peoplePart.people, record.name);
    if (!currentIdentity) continue;
    const validationIdentities = new Set(record.validationIdentities);
    validationIdentities.add(pairKey(currentIdentity));
    sourceComments.set(id, { ...record, validationIdentities });
  }
  return {
    comments: prepared,
    part,
    assignments: nextAssignments,
    warnings,
    source: { ...source, comments: sourceComments, localCommentIds },
  };
}

/** Overlay dynamic people bytes/relationship at the ZIP boundary; generated data never enters convertedXml/Yjs. */
export function commentPeopleUpdatedFiles(convertedXml, part, originalFiles = []) {
  if (!part) return {};
  const xml = serializeOpcXml(part.tree);
  const raw = originalFiles.find((file) => file.name === part.path)?.content;
  const unchangedRaw =
    part.unchanged &&
    typeof raw === 'string' &&
    serializeOpcXml(preservePeopleWhitespace(raw, xmljs.xml2js(raw))) === xml;
  const files = { [part.path]: unchangedRaw ? raw : xml };
  if (!readPeoplePart(convertedXml).path) {
    const relations = carbonCopy(convertedXml[RELS_PATH]);
    const root = relations.elements.find((node) => isName(node.name, 'Relationships', REL_NAMESPACE, scopeFor(node)));
    root.elements ||= [];
    const ids = new Set(root.elements.map((node) => node.attributes?.Id));
    let index = 1;
    while (ids.has(`rId${index}`)) index++;
    const scope = scopeFor(root);
    const prefix = root.name.includes(':') ? `${root.name.split(':')[0]}:` : '';
    root.elements.push({
      type: 'element',
      name: `${prefix}Relationship`,
      attributes: {
        Id: `rId${index}`,
        Type: PEOPLE_RELATIONSHIP,
        Target: `/${part.path}`,
      },
    });
    // Retain the root's namespace declaration via xml-js rather than the document serializer.
    if (scope[prefix.slice(0, -1)] !== REL_NAMESPACE && !prefix)
      root.attributes = { ...root.attributes, xmlns: REL_NAMESPACE };
    files[RELS_PATH] = serializeOpcXml(relations);
  }
  return files;
}
