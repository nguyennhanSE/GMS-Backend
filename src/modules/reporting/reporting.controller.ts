import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../libs/decorator/roles.decorator';
import { ResponseModel } from '../../libs/models/response/response.model';
import { ERoleName } from '../roles/enums/role.enum';
import { ClassPerformanceQueryDto } from './dto/class-performance-query.dto';
import { RevenueAnalyticsQueryDto } from './dto/revenue-analytics-query.dto';
import { ReportingService } from './reporting.service';

@ApiTags('Reporting')
@ApiBearerAuth()
@Roles(ERoleName.ADMIN)
@Controller('reporting')
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('summary-kpis')
  @ApiOperation({ summary: 'Get summary KPIs for the admin dashboard' })
  @ApiResponse({
    status: 200,
    description: 'Summary KPIs retrieved successfully',
  })
  async getSummaryKpis() {
    const responseModel = new ResponseModel();
    const result = await this.reportingService.getSummaryKpis();
    responseModel.setData(result);
    return responseModel;
  }

  @Get('revenue-analytics')
  @ApiOperation({
    summary: 'Get revenue analytics time series for the admin dashboard',
  })
  @ApiResponse({
    status: 200,
    description: 'Revenue analytics retrieved successfully',
  })
  async getRevenueAnalytics(@Query() query: RevenueAnalyticsQueryDto) {
    const responseModel = new ResponseModel();
    const result = await this.reportingService.getRevenueAnalytics(query);
    responseModel.setData(result);
    return responseModel;
  }

  @Get('class-performance')
  @ApiOperation({
    summary: 'Get class performance insights for the admin dashboard',
  })
  @ApiResponse({
    status: 200,
    description: 'Class performance retrieved successfully',
  })
  async getClassPerformance(@Query() query: ClassPerformanceQueryDto) {
    const responseModel = new ResponseModel();
    const result = await this.reportingService.getClassPerformance(query);
    responseModel.setData(result);
    return responseModel;
  }
}
