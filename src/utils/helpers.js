// backend/src/utils/helpers.js
const crypto = require('crypto');
const moment = require('moment-timezone');

/**
 * Generate a random string
 * @param {number} length - Length of the string
 * @returns {string} Random string
 */
const generateRandomString = (length = 10) => {
  return crypto.randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
};

/**
 * Generate a unique ID with prefix
 * @param {string} prefix - Prefix for the ID
 * @returns {string} Unique ID
 */
const generateUniqueId = (prefix = '') => {
  const timestamp = Date.now().toString(36);
  const random = generateRandomString(5);
  return `${prefix}${timestamp}${random}`.toUpperCase();
};

/**
 * Format currency
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency code
 * @returns {string} Formatted currency
 */
const formatCurrency = (amount, currency = 'KES') => {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: currency
  }).format(amount);
};

/**
 * Format phone number to international format
 * @param {string} phone - Phone number
 * @returns {string} Formatted phone number
 */
const formatPhoneNumber = (phone) => {
  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, '');
  
  // Handle Kenyan numbers
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.substring(1);
  } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
    cleaned = '254' + cleaned;
  }
  
  return '+' + cleaned;
};

/**
 * Calculate percentage
 * @param {number} value - Value
 * @param {number} total - Total
 * @param {number} decimals - Decimal places
 * @returns {number} Percentage
 */
const calculatePercentage = (value, total, decimals = 2) => {
  if (total === 0) return 0;
  return Number(((value / total) * 100).toFixed(decimals));
};

/**
 * Calculate date difference
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @param {string} unit - Unit (days, hours, minutes)
 * @returns {number} Difference
 */
const dateDifference = (startDate, endDate, unit = 'days') => {
  const start = moment(startDate);
  const end = moment(endDate);
  return end.diff(start, unit);
};

/**
 * Format date for display
 * @param {Date} date - Date to format
 * @param {string} format - Format string
 * @returns {string} Formatted date
 */
const formatDate = (date, format = 'DD/MM/YYYY') => {
  return moment(date).tz('Africa/Nairobi').format(format);
};

/**
 * Get date range
 * @param {string} period - Period (today, week, month, year)
 * @returns {object} Start and end dates
 */
const getDateRange = (period) => {
  const now = moment().tz('Africa/Nairobi');
  let start, end;

  switch (period) {
    case 'today':
      start = now.clone().startOf('day');
      end = now.clone().endOf('day');
      break;
    case 'yesterday':
      start = now.clone().subtract(1, 'day').startOf('day');
      end = now.clone().subtract(1, 'day').endOf('day');
      break;
    case 'week':
      start = now.clone().startOf('week');
      end = now.clone().endOf('week');
      break;
    case 'month':
      start = now.clone().startOf('month');
      end = now.clone().endOf('month');
      break;
    case 'year':
      start = now.clone().startOf('year');
      end = now.clone().endOf('year');
      break;
    case 'last7days':
      start = now.clone().subtract(7, 'days').startOf('day');
      end = now.clone().endOf('day');
      break;
    case 'last30days':
      start = now.clone().subtract(30, 'days').startOf('day');
      end = now.clone().endOf('day');
      break;
    default:
      start = now.clone().startOf('day');
      end = now.clone().endOf('day');
  }

  return {
    start: start.toDate(),
    end: end.toDate()
  };
};

/**
 * Paginate array
 * @param {Array} array - Array to paginate
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @returns {object} Paginated data
 */
const paginate = (array, page = 1, limit = 10) => {
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  const total = array.length;
  const totalPages = Math.ceil(total / limit);

  return {
    data: array.slice(startIndex, endIndex),
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: endIndex < total,
      hasPrev: startIndex > 0
    }
  };
};

/**
 * Group array by key
 * @param {Array} array - Array to group
 * @param {string} key - Key to group by
 * @returns {object} Grouped object
 */
const groupBy = (array, key) => {
  return array.reduce((result, item) => {
    const group = item[key];
    if (!result[group]) result[group] = [];
    result[group].push(item);
    return result;
  }, {});
};

/**
 * Calculate tax
 * @param {number} amount - Amount
 * @param {number} rate - Tax rate (percentage)
 * @param {boolean} inclusive - Is tax inclusive
 * @returns {object} Tax calculation
 */
const calculateTax = (amount, rate = 16, inclusive = false) => {
  let taxAmount, netAmount, grossAmount;

  if (inclusive) {
    // Tax is included in the amount
    netAmount = amount / (1 + rate / 100);
    taxAmount = amount - netAmount;
    grossAmount = amount;
  } else {
    // Tax is not included
    netAmount = amount;
    taxAmount = amount * (rate / 100);
    grossAmount = amount + taxAmount;
  }

  return {
    netAmount: Number(netAmount.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    grossAmount: Number(grossAmount.toFixed(2)),
    rate
  };
};

/**
 * Validate email
 * @param {string} email - Email to validate
 * @returns {boolean} Is valid
 */
const isValidEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

/**
 * Validate Kenyan phone number
 * @param {string} phone - Phone number
 * @returns {boolean} Is valid
 */
const isValidKenyanPhone = (phone) => {
  const regex = /^(\+254|0)[17]\d{8}$/;
  return regex.test(phone);
};

/**
 * Sanitize input
 * @param {string} input - Input to sanitize
 * @returns {string} Sanitized input
 */
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/\$/g, ''); // Remove $ to prevent MongoDB injection
};

/**
 * Generate receipt number
 * @param {number} sequence - Sequence number
 * @returns {string} Receipt number
 */
const generateReceiptNumber = (sequence) => {
  const date = moment().tz('Africa/Nairobi');
  const year = date.format('YY');
  const month = date.format('MM');
  const day = date.format('DD');
  const seq = sequence.toString().padStart(5, '0');
  
  return `RCP${year}${month}${day}${seq}`;
};

/**
 * Calculate distance between coordinates
 * @param {number} lat1 - Latitude 1
 * @param {number} lon1 - Longitude 1
 * @param {number} lat2 - Latitude 2
 * @param {number} lon2 - Longitude 2
 * @returns {number} Distance in kilometers
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRadians = (degrees) => {
  return degrees * (Math.PI / 180);
};

/**
 * Retry async function
 * @param {Function} fn - Function to retry
 * @param {number} retries - Number of retries
 * @param {number} delay - Delay between retries (ms)
 * @returns {Promise} Result
 */
const retryAsync = async (fn, retries = 3, delay = 1000) => {
  try {
    return await fn();
  } catch (error) {
    if (retries === 0) throw error;
    
    await new Promise(resolve => setTimeout(resolve, delay));
    return retryAsync(fn, retries - 1, delay * 2);
  }
};

/**
 * Format file size
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size
 */
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

module.exports = {
  generateRandomString,
  generateUniqueId,
  formatCurrency,
  formatPhoneNumber,
  calculatePercentage,
  dateDifference,
  formatDate,
  getDateRange,
  paginate,
  groupBy,
  calculateTax,
  isValidEmail,
  isValidKenyanPhone,
  sanitizeInput,
  generateReceiptNumber,
  calculateDistance,
  retryAsync,
  formatFileSize
};