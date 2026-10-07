import { useWorkspaceRole } from '../../api/rbac';
import ProfilesPanel from './ProfilesPanel';

type ProfilesTabProps = {
  workspace: string;
};

// The provider profiles a workspace sees: its own and the platform's. A
// workspace admin manages the workspace's own.
const ProfilesTab: React.FC<ProfilesTabProps> = ({ workspace }) => {
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  return <ProfilesPanel scope={workspace} canManage={isWorkspaceAdmin} />;
};

export default ProfilesTab;
