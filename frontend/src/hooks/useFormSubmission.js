/**
 * Generic form-submission hook backed by FormBold.
 * Manages form state, sanitisation, submission, and status feedback.
 * Ported from onehub/hooks/useFormSubmission.ts.
 */
import { useState } from "react";
import { sanitizeFormData } from "../lib/sanitize.js";
import { submitToFormBold } from "../lib/formbold.js";

const FORM_SUBMISSION_FAILED_MESSAGE =
  "Form submission failed. Please try again later.";

const NETWORK_ERROR_MESSAGE =
  "Network error. Please check your connection and try again.";

/**
 * @param {object} initialData - Initial form field values.
 * @param {{ submitEndpoint: string, successMessage?: string, onSuccess?: (data: object) => void, buildPayload?: (data: object) => object }} options
 */
export function useFormSubmission(initialData, options) {
  const [formData, setFormData] = useState(initialData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState({
    type: null,
    message: "",
  });

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormData((prev) => ({ ...prev, [name]: value }));

    if (submitStatus.type) {
      setSubmitStatus({ type: null, message: "" });
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    setIsSubmitting(true);
    setSubmitStatus({ type: null, message: "" });

    try {
      const payload = options.buildPayload
        ? options.buildPayload(formData)
        : formData;

      const sanitizedPayload = sanitizeFormData(payload);

      const result = await submitToFormBold(sanitizedPayload, {
        endpoint: options.submitEndpoint,
      });

      if (result.success) {
        setSubmitStatus({
          type: "success",
          message:
            options.successMessage ??
            "Thank you! Your submission has been received successfully.",
        });
        setFormData(initialData);
        options.onSuccess?.(sanitizedPayload);
      } else {
        setSubmitStatus({
          type: "error",
          message: result.error ?? FORM_SUBMISSION_FAILED_MESSAGE,
        });
      }
    } catch {
      setSubmitStatus({
        type: "error",
        message: NETWORK_ERROR_MESSAGE,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    formData,
    isSubmitting,
    submitStatus,
    handleChange,
    handleSubmit,
  };
}
