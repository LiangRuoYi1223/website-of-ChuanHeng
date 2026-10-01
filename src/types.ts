export interface Activity {
  id: string; title: string; category: string; kind: 'upcoming' | 'past';
  date: string; location: string; difficulty: string; summary: string;
  description: string; image: string; signupUrl: string; qrImage: string;
  status: 'draft' | 'published'; isDemo: boolean; revision?: number;
  duration?: string; cost?: string; meetingPoint?: string;
  beginnerFriendly?: string; registrationStatus?: string;
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
export interface PublicContent { settings: SiteSettings; activities: Activity[]; projects: Project[]; }
export interface User { id: string; username: string; displayName: string; role: 'admin' | 'editor'; mustChangePassword?: boolean; }
