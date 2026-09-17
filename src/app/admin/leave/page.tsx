"use client";

import React from "react";
import { useAdminPageHeader } from "@/context/admin-page-header-context";
import { LeaveManagement } from "@/app/admin/components/leave-management";

export default function LeavePage() {
  const { setTitle } = useAdminPageHeader();

  React.useEffect(() => {
    setTitle("请假审批");
  }, [setTitle]);

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <LeaveManagement />
      </div>
    </div>
  );
}
