import { describe, expect, it } from 'vitest';
import { mapProject } from './map.js';
import { wireProjectSchema } from './wire.js';

describe('a project, through the boundary', () => {
  const wire = {
    id: 'project-0009',
    name: 'Inbox',
    parent_id: null,
    is_archived: false,
    is_deleted: false,
    child_order: 0,
  };

  it('marks the user’s Inbox, which the tool flags only there (S11)', () => {
    const project = mapProject(wireProjectSchema.parse({ ...wire, inbox_project: true }));
    expect(project.inbox).toBe(true);
  });

  it('says nothing about the Inbox on any other project', () => {
    const project = mapProject(wireProjectSchema.parse({ ...wire, name: 'Health' }));
    expect(project).not.toHaveProperty('inbox');
  });
});
