import jwt from "jsonwebtoken";
import moment from "moment";
import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import SibApiV3Sdk from "@getbrevo/brevo";
import { createReport } from "docx-templates";

export const generateToken = (res, userId) => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_LIFETIME,
  });

  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development", // Use secure cookies in production
    sameSite: "strict", // Prevent CSRF attacks
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
};

export const capitalLetter = (phrase) => {
  return phrase
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

export const serviceDates = ({ frequency, serviceStartDate, contract }) => {
  const serviceDates = [];
  const months = new Set();
  let serviceDate = serviceStartDate.first;
  let frequencyDays = 365,
    add = "Days",
    end = 1;

  const diffDays = moment(contract.endDate).diff(
    moment(contract.startDate),
    "days"
  );
  const endDate = contract.endDate;

  if (frequency === "2 Times In A Week" || frequency === "Weekly") {
    frequencyDays = 7;
    end = Math.floor(diffDays / frequencyDays);
  } else if (frequency === "2 Times In A Month") {
    frequencyDays = 15;
    end = Math.floor(diffDays / frequencyDays);
  } else if (frequency === "3 Times In A Month") {
    frequencyDays = 10;
    end = Math.floor(diffDays / frequencyDays);
  } else if (frequency === "Monthly") {
    frequencyDays = 1;
    add = "Months";
    end = Math.floor(diffDays / 30);
  } else if (frequency === "Quarterly") {
    frequencyDays = 3;
    add = "Months";
    end = Math.floor(diffDays / 90);
  }

  if (frequency === "2 Times In A Week") {
    const first = Math.abs(
      moment(serviceDate).diff(moment(serviceStartDate.second), "days")
    );
    const nextDay = moment(serviceDate).add(7, "days");
    const second = Math.abs(
      moment(serviceStartDate.second).diff(nextDay, "days")
    );

    end = end * 2;
    while (moment(serviceDate).isBefore(moment(endDate)) && end > 0) {
      serviceDates.push(moment(serviceDate).format("DD/MM/YYYY"));
      months.add(moment(serviceDate).format("MMM YY"));

      serviceDate = moment(serviceDate).add(first, "days");
      end -= 1;
      if (moment(serviceDate).isAfter(endDate) || end === 0) break;

      serviceDates.push(moment(serviceDate).format("DD/MM/YYYY"));
      serviceDate = moment(serviceDate).add(second, "days");
      end -= 1;
      if (moment(serviceDate).isAfter(endDate) || end === 0) break;
    }
  } else {
    while (moment(serviceDate).isBefore(moment(endDate)) && end > 0) {
      if (moment(serviceDate).format("dddd") === "Sunday") {
        serviceDates.push(
          moment(serviceDate).add(1, "Day").format("DD/MM/YYYY")
        );
      } else {
        serviceDates.push(moment(serviceDate).format("DD/MM/YYYY"));
      }

      months.add(moment(serviceDate).format("MMM YY"));
      serviceDate = moment(serviceDate).add(frequencyDays, add);
      end -= 1;
    }
  }

  const serviceMonths = [...months];

  return { serviceMonths, serviceDates };
};

export const uploadFile = async ({ filePath, folder }) => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      use_filename: true,
      folder,
      quality: 40,
      resource_type: "auto",
    });

    fs.unlinkSync(filePath);

    return result.secure_url;
  } catch (error) {
    console.log("Cloud Upload", error);
    return false;
  }
};

export const sendBrevoEmail = async ({
  attachment,
  dynamicData,
  emailList,
  templateId,
}) => {
  try {
    let defaultClient = SibApiV3Sdk.ApiClient.instance;
    let apiKey = defaultClient.authentications["api-key"];
    apiKey.apiKey = process.env.BREVO_API_KEY;
    let apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
    let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

    sendSmtpEmail.sender = {
      name: "PMS",
      email: process.env.NO_REPLY_EMAIL,
    };
    sendSmtpEmail.to = emailList;
    sendSmtpEmail.params = dynamicData;
    sendSmtpEmail.templateId = templateId;
    if (attachment) sendSmtpEmail.attachment = attachment;
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
};

export const createServiceCard = async ({
  contract,
  contractPeriod,
  cardQrCode,
  service,
}) => {
  try {
    const template = fs.readFileSync("./tmp/cardTemp.docx");

    const buffer = await createReport({
      cmdDelimiter: ["{", "}"],
      template,

      additionalJsContext: {
        contractNo: contract.contractNo,
        sales: contract.sales,
        name: contract.shipToDetails.name,
        address: contract.shipToDetails.address,
        city: contract.shipToDetails.city,
        nearBy: contract.shipToDetails.nearBy,
        shipArea: contract.shipToDetails.area,
        pincode: contract.shipToDetails.pincode,
        contact1: contract.shipToDetails.contact[0],
        contact2: contract.shipToDetails.contact[1],
        serviceDue: service.serviceMonths,
        service: service.services,
        frequency: service.frequency,
        location: service.treatmentLocation,
        area: service.area,
        billingFrequency: contract.billingFrequency,
        contractPeriod: contractPeriod,
        instruction: service.instruction,
        url: "12",
        qrCode: async (url12) => {
          const dataUrl = cardQrCode;
          const data = await dataUrl.slice("data:image/png;base64,".length);
          return { width: 2.5, height: 2.5, data, extension: ".png" };
        },
      },
    });

    return buffer;
  } catch (error) {
    console.log(error);
    return false;
  }
};
