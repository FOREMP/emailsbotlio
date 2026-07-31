import { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Send, Users, Mail, FileSpreadsheet, Globe, BarChart3,
  Sparkles, Target, CheckCircle2, ChevronDown, Rocket,
} from "lucide-react";
import Header from "@/components/Header";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

const primaryTabs = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/sequences", label: "Sequences", icon: Send },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/contacts", label: "Contacts", icon: Users },
];

const websiteTabs = [
  { to: "/site-leads", label: "Leads & Generator", icon: Target },
  { to: "/site-approvals", label: "Approvals", icon: CheckCircle2 },
  { to: "/site-outreach", label: "Demo Outreach", icon: Rocket },

];

const trailingTabs = [
  { to: "/senders", label: "Senders", icon: Mail },
  { to: "/domains", label: "Domains", icon: Globe },
  { to: "/files", label: "Files", icon: FileSpreadsheet },
];

interface AppLayoutProps {
  children: ReactNode;
  /** When true, removes the inner container/padding so children can manage their own. */
  bare?: boolean;
}

const AppLayout = ({ children, bare }: AppLayoutProps) => {
  const location = useLocation();
  const websitesActive = websiteTabs.some((t) => location.pathname.startsWith(t.to));

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
      isActive
        ? "border-primary text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground"
    );

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="pt-16">
        <nav className="border-b border-border bg-background/60 backdrop-blur sticky top-16 z-40">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-1 overflow-x-auto -mb-px">
              {primaryTabs.map((t) => (
                <NavLink key={t.to} to={t.to} end={t.to === "/dashboard"} className={linkClass}>
                  <t.icon className="h-4 w-4" />
                  {t.label}
                </NavLink>
              ))}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      "inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap outline-none",
                      websitesActive
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Sparkles className="h-4 w-4" />
                    Websites
                    <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[200px]">
                  {websiteTabs.map((t) => (
                    <DropdownMenuItem key={t.to} asChild>
                      <NavLink
                        to={t.to}
                        className={({ isActive }) =>
                          cn(
                            "flex items-center gap-2 w-full cursor-pointer",
                            isActive && "bg-accent text-accent-foreground"
                          )
                        }
                      >
                        <t.icon className="h-4 w-4" />
                        {t.label}
                      </NavLink>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {trailingTabs.map((t) => (
                <NavLink key={t.to} to={t.to} className={linkClass}>
                  <t.icon className="h-4 w-4" />
                  {t.label}
                </NavLink>
              ))}
            </div>
          </div>
        </nav>
        <main className={bare ? "" : "container mx-auto px-4 py-8"}>{children}</main>
      </div>
    </div>
  );
};

export default AppLayout;
