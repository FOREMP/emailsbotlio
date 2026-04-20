import { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, Send, Users, Mail, FileSpreadsheet, Globe } from "lucide-react";
import Header from "@/components/Header";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/sequences", label: "Sequences", icon: Send },
  { to: "/contacts", label: "Contacts", icon: Users },
  { to: "/senders", label: "Senders", icon: Mail },
  { to: "/domains", label: "Domains", icon: Globe },
  { to: "/files", label: "Files", icon: FileSpreadsheet },
];

interface AppLayoutProps {
  children: ReactNode;
  /** When true, removes the inner container/padding so children can manage their own (e.g. fullscreen canvas). */
  bare?: boolean;
}

const AppLayout = ({ children, bare }: AppLayoutProps) => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="pt-16">
        <nav className="border-b border-border bg-background/60 backdrop-blur sticky top-16 z-40">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-1 overflow-x-auto -mb-px">
              {tabs.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  end={t.to === "/dashboard"}
                  className={({ isActive }) =>
                    cn(
                      "inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                      isActive
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )
                  }
                >
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
