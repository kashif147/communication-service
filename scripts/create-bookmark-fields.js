#!/usr/bin/env node

import dotenvFlow from "dotenv-flow";
dotenvFlow.config({ node_env: "staging" });

import { connectDB, disconnectDB } from "../config/db.js";
import BookmarkField from "../model/bookmarkField.model.js";
import logger from "../config/logger.js";

// Bookmark fields to create based on profile and subscription models
const bookmarkFields = [
  { key: "normalizedEmail", label: "Normalized Email", path: "profile.normalizedEmail", dataType: "string" },
  { key: "membershipNumber", label: "Membership Number", path: "profile.membershipNumber", dataType: "string" },
  { key: "title", label: "Title", path: "profile.personalInfo.title", dataType: "string" },
  { key: "surname", label: "Surname", path: "profile.personalInfo.surname", dataType: "string" },
  { key: "forename", label: "Forename", path: "profile.personalInfo.forename", dataType: "string" },
  { key: "gender", label: "Gender", path: "profile.personalInfo.gender", dataType: "string" },
  { key: "dateOfBirth", label: "Date of Birth", path: "profile.personalInfo.dateOfBirth", dataType: "date" },
  { key: "buildingOrHouse", label: "Building or House", path: "profile.contactInfo.address.buildingOrHouse", dataType: "string" },
  { key: "streetOrRoad", label: "Street or Road", path: "profile.contactInfo.address.streetOrRoad", dataType: "string" },
  { key: "areaOrTown", label: "Area or Town", path: "profile.contactInfo.address.areaOrTown", dataType: "string" },
  { key: "countyCityOrPostCode", label: "County City or Post Code", path: "profile.contactInfo.address.countyCityOrPostCode", dataType: "string" },
  { key: "eircode", label: "Eircode", path: "profile.contactInfo.address.eircode", dataType: "string" },
  { key: "country", label: "Country", path: "profile.contactInfo.address.country", dataType: "string" },
  { key: "fullAddress", label: "Full Address", path: "profile.contactInfo.address.fullAddress", dataType: "string" },
  { key: "mobileNumber", label: "Mobile Number", path: "profile.contactInfo.mobileNumber", dataType: "string" },
  { key: "personalEmail", label: "Personal Email", path: "profile.contactInfo.personalEmail", dataType: "string" },
  { key: "workEmail", label: "Work Email", path: "profile.contactInfo.workEmail", dataType: "string" },
  { key: "studyLocation", label: "Study Location", path: "profile.professionalInfo.studyLocation", dataType: "string" },
  { key: "startDate", label: "Start Date", path: "subscription.startDate", dataType: "date" },
  { key: "graduationDate", label: "Graduation Date", path: "profile.professionalInfo.graduationDate", dataType: "date" },
  { key: "workLocation", label: "Work Location", path: "profile.professionalInfo.workLocation", dataType: "string" },
  { key: "payrollNo", label: "Payroll Number", path: "subscription.payrollNo", dataType: "string" },
  { key: "branch", label: "Branch", path: "profile.professionalInfo.branch", dataType: "string" },
  { key: "region", label: "Region", path: "profile.professionalInfo.region", dataType: "string" },
  { key: "grade", label: "Grade", path: "profile.professionalInfo.grade", dataType: "string" },
  { key: "nmbiNumber", label: "NMBI Number", path: "profile.professionalInfo.nmbiNumber", dataType: "string" },
  { key: "subscriptionStatus", label: "Subscription Status", path: "subscription.subscriptionStatus", dataType: "string" },
  { key: "endDate", label: "End Date", path: "subscription.endDate", dataType: "date" },
  { key: "dateCancelled", label: "Date Cancelled", path: "subscription.cancellation.dateCancelled", dataType: "date" },
  { key: "dateResigned", label: "Date Resigned", path: "subscription.resignation.dateResigned", dataType: "date" },
  { key: "remindersType", label: "Reminders Type", path: "subscription.reminders.type", dataType: "string" },
  { key: "remindersReminderDate", label: "Reminders Reminder Date", path: "subscription.reminders.reminderDate", dataType: "date" },
  { key: "membershipCategory", label: "Membership Category", path: "subscription.membershipCategory", dataType: "string" },
  { key: "paymentType", label: "Payment Type", path: "subscription.paymentType", dataType: "string" },
  { key: "paymentFrequency", label: "Payment Frequency", path: "subscription.paymentFrequency", dataType: "string" },
];

async function createBookmarkFields() {
  console.log("🚀 Creating Bookmark Fields");
  console.log(`   Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`   MongoDB URI: ${process.env.MONGODB_URI ? "✓ Configured" : "✗ Not configured"}\n`);

  try {
    await connectDB();
    console.log("   Database: ✓ Connected\n");

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const fieldData of bookmarkFields) {
      try {
        const existing = await BookmarkField.findOne({ key: fieldData.key });
        
        if (existing) {
          // Update existing field
          existing.label = fieldData.label;
          existing.path = fieldData.path;
          existing.dataType = fieldData.dataType;
          await existing.save();
          updated++;
          console.log(`   ✓ Updated: ${fieldData.key}`);
        } else {
          // Create new field
          await BookmarkField.create(fieldData);
          created++;
          console.log(`   ✓ Created: ${fieldData.key}`);
        }
      } catch (error) {
        if (error.code === 11000) {
          // Duplicate key error
          skipped++;
          console.log(`   ⊘ Skipped: ${fieldData.key} (duplicate)`);
        } else {
          console.error(`   ✗ Error creating ${fieldData.key}:`, error.message);
        }
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("📊 Summary");
    console.log("=".repeat(60));
    console.log(`✅ Created: ${created}`);
    console.log(`🔄 Updated: ${updated}`);
    console.log(`⊘ Skipped: ${skipped}`);
    console.log(`📦 Total: ${bookmarkFields.length}`);

    // Verify all fields exist
    const allFields = await BookmarkField.find();
    console.log(`\n📋 Total bookmark fields in database: ${allFields.length}`);

    // List all fields
    console.log("\n📝 Bookmark Fields:");
    allFields.forEach(field => {
      console.log(`   - ${field.key}: ${field.path} (${field.dataType})`);
    });

    await disconnectDB();
    console.log("\n✅ Complete!");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

createBookmarkFields();

