export function assignmentGroupOptions(groups = []) {
  return groups.map((group) => ({
    value: group.name,
    label: group.name,
    href: `/workspace/users/groups/${group.groupId || group.id}`,
  }));
}
