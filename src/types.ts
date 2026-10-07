export interface Activity {
  id: string; title: string; category: string; kind: 'upcoming' | 'past';
  date: string; location: string; difficulty: string; summary: string;
  routeName?: string; cityCode?: string;
  description: string; image: string; signupUrl: string; qrImage: string;
  status: 'draft' | 'published'; isDemo: boolean; revision?: number;
  duration?: string; cost?: string; meetingPoint?: string;
  beginnerFriendly?: string; registrationStatus?: string;
  registrationOpen?: boolean;
  timeCommitment?: 'half-day' | 'full-day' | 'multi-day';
  experience?: 'relaxed' | 'scenic' | 'skills';
  album?: { id: string; src: string; alt: string; caption: string; isDemo?: boolean }[];
  preparation?: { notice?: string; items: { id: string; title: string; description: string }[] };
}
export interface Project {
  id: string; title: string; mountain: string; elevation: string;
  plannedDate: string; duration: string; summary: string; description: string;
  trainingPlan: string; supportNeeds: string; cooperationValue: string;
  image: string; status: 'draft' | 'published'; isDemo: boolean; revision?: number;
}
export interface SiteSettings {
  logoUrl?: string; demoMode?: boolean;
  semesterName?: string; semesterStart?: string; semesterEnd?: string;
  clubName: string; school: string; founded: string; intro: string;
  aboutDescription: string; teamDescription: string; teamTraining: string;
  teamAchievements: string; heroActivities: string; heroAbout: string; heroTeam: string;
  storyHiking: string; storyClimbing: string;
  officialSignupUrl: string; officialQrImage: string; signupInstructions: string;
  contactEmail: string; contactWechat: string; contactName: string;
  growthSteps: { title: string; description: string }[];
  revision?: number;
}
export interface CooperationContent {
  title: string;
  intro: string;
  qualificationTitle: string;
  qualificationDescription: string;
  trainingFocus: string[];
  qualifications: {
    id: string;
    name: string;
    qualification: string;
    description: string;
    isDemo: boolean;
  }[];
  supportWays: { id: string; title: string; description: string }[];
  benefits: { id: string; direction: string; content: string; confirmation: string }[];
  process: { id: string; title: string; description: string }[];
  contact: { name: string; email: string; wechat: string; isDemo: boolean };
  handbook: {
    title: string;
    subtitle: string;
    filename: string;
    coverImage: string;
    pages: number;
    versionLabel: string;
    updatedAt: string;
  };
  demoNotice: string;
}
export interface PublicContent {
  settings: SiteSettings;
  activities: Activity[];
  projects: Project[];
  cooperation?: CooperationContent;
}
export type UserRole = 'founder' | 'admin' | 'member' | 'viewer';
export type ContentPermission = 'settings:write' | 'activities:write' | 'projects:write' | 'uploads:write';
export interface User {
  id: string; username: string; displayName: string; role: UserRole;
  permissions: string[]; mustChangePassword?: boolean; active?: boolean;
}
export interface Registration { id: string; activityId: string; createdAt: string; }
