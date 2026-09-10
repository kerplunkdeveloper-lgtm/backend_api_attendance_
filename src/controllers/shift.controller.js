const shiftService = require("../services/shift.service");
const { evaluateAttendanceAgainstShift } = require("../utils/shiftCalculator");

const create = async (req, res) => {
  try {
    const shift = await shiftService.createShift(req.user.organizationId, req.body);

    return res.status(201).json({
      success: true,
      message: "Shift created successfully",
      data: shift,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const list = async (req, res) => {
  try {
    const shifts = await shiftService.getShifts(req.user.organizationId);

    return res.json({
      success: true,
      message: "Shifts fetched successfully",
      data: shifts,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const shift = await shiftService.getShiftById(req.user.organizationId, id);

    return res.json({
      success: true,
      message: "Shift details fetched successfully",
      data: shift,
    });
  } catch (error) {
    return res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await shiftService.updateShift(req.user.organizationId, id, req.body);

    return res.json({
      success: true,
      message: "Shift updated successfully",
      data: updated,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const remove = async (req, res) => {
  try {
    const { id } = req.params;
    await shiftService.deleteShift(req.user.organizationId, id);

    return res.json({
      success: true,
      message: "Shift deleted successfully",
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const assign = async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeIds } = req.body;
    const result = await shiftService.assignEmployeesToShift(
      req.user.organizationId,
      id,
      employeeIds
    );

    return res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// Interactive Shift Simulator endpoint
const simulate = async (req, res) => {
  try {
    const { startTime, endTime, graceMinutes, checkIn, checkOut } = req.body;

    const dummyShift = {
      startTime: startTime || "09:00",
      endTime: endTime || "18:00",
      graceMinutes: typeof graceMinutes === "number" ? graceMinutes : 10,
    };

    const metrics = evaluateAttendanceAgainstShift(
      dummyShift,
      checkIn ? new Date(checkIn) : new Date(),
      checkOut ? new Date(checkOut) : null
    );

    return res.json({
      success: true,
      shift: dummyShift,
      metrics,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  create,
  list,
  getById,
  update,
  remove,
  assign,
  simulate,
};
